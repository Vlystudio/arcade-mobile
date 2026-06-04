// Supabase Edge Function — moderate-image (AWS Rekognition)
// Called after every photo upload. Downloads the image and sends it to
// AWS Rekognition DetectModerationLabels. If flagged: deletes the file
// from storage, reverts the DB record, logs to admin_audit_log, and
// returns { flagged: true, message } so the client can warn the user.
// Fails open — if credentials are missing or the API errors the upload
// is allowed through so the app keeps working.
//
// Required env vars (set in Supabase Dashboard → Edge Functions → Secrets):
//   AWS_ACCESS_KEY_ID      — IAM user with rekognition:DetectModerationLabels
//   AWS_SECRET_ACCESS_KEY  — IAM user secret
//   AWS_REGION             — e.g. us-east-1 (default: us-east-1)

import { createClient }                                from "https://esm.sh/@supabase/supabase-js@2";
import { RekognitionClient, DetectModerationLabelsCommand } from "https://esm.sh/@aws-sdk/client-rekognition@3";

const AWS_KEY    = Deno.env.get("AWS_ACCESS_KEY_ID")     ?? "";
const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") ?? "";
const AWS_REGION = Deno.env.get("AWS_REGION")            ?? "us-east-1";
const SUPA_URL   = Deno.env.get("SUPABASE_URL")!;
const SUPA_SVC   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Minimum Rekognition confidence to act on (0–100). 70 = fairly strict.
const MIN_CONFIDENCE = 70;

// Rekognition label → user-facing reason string.
// Only labels in this map trigger removal.
const BLOCK_LABELS: Record<string, string> = {
  "Explicit Nudity":          "explicit nudity",
  "Graphic Male Nudity":      "explicit nudity",
  "Graphic Female Nudity":    "explicit nudity",
  "Sexual Activity":          "explicit sexual content",
  "Partial Nudity":           "nudity",
  "Suggestive":               "suggestive content",
  "Revealing Clothes":        "suggestive content",
  "Violence":                 "violent content",
  "Graphic Violence Or Gore": "graphic violence or gore",
  "Physical Violence":        "violent content",
  "Weapon Violence":          "violent content",
  "Hate Symbols":             "hate symbols",
  "Nazi Party":               "hateful content",
  "White Supremacy":          "hateful content",
  "Extremist":                "extremist content",
  "Visually Disturbing":      "disturbing content",
  "Gore":                     "graphic violence or gore",
  "Explosions And Blasts":    "violent content",
};

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: CORS });

  // Fail open when credentials not configured (dev environments)
  if (!AWS_KEY || !AWS_SECRET) {
    console.warn("[moderate-image] AWS credentials not configured — skipping moderation");
    return Response.json({ ok: true, flagged: false, skipped: true }, { headers: CORS });
  }

  const { image_url, bucket, path, record_type, record_id } = await req.json() as {
    image_url:   string;
    bucket:      string;
    path:        string;
    record_type: "avatar" | "post" | "score_proof" | string;
    record_id:   string;
  };

  if (!image_url) {
    return Response.json({ error: "image_url required" }, { status: 400, headers: CORS });
  }

  try {
    // ── Fetch image bytes ─────────────────────────────────────────────────────
    const imgRes = await fetch(image_url);
    if (!imgRes.ok) {
      console.warn("[moderate-image] Could not fetch image — skipping:", imgRes.status);
      return Response.json({ ok: true, flagged: false }, { headers: CORS });
    }
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());

    // ── Call AWS Rekognition ──────────────────────────────────────────────────
    const rekognition = new RekognitionClient({
      region:      AWS_REGION,
      credentials: { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET },
    });

    const { ModerationLabels = [] } = await rekognition.send(
      new DetectModerationLabelsCommand({
        Image:         { Bytes: imgBytes },
        MinConfidence: MIN_CONFIDENCE,
      }),
    );

    // ── Evaluate labels ───────────────────────────────────────────────────────
    const reasons = new Set<string>();
    for (const label of ModerationLabels) {
      const name = label.Name ?? "";
      if (BLOCK_LABELS[name]) reasons.add(BLOCK_LABELS[name]);
    }

    if (reasons.size === 0) {
      return Response.json({ ok: true, flagged: false }, { headers: CORS });
    }

    const uniqueReasons = [...reasons];

    // ── Flagged: clean up ─────────────────────────────────────────────────────
    const admin = createClient(SUPA_URL, SUPA_SVC, { auth: { persistSession: false } });

    // Remove file from storage
    if (bucket && path) {
      const { error: delErr } = await admin.storage.from(bucket).remove([path]);
      if (delErr) console.error("[moderate-image] storage delete error:", delErr.message);
    }

    // Revert database record
    if (record_type === "avatar" && record_id) {
      await admin.from("profiles").update({ avatar_url: null }).eq("id", record_id);
    } else if (record_type === "post" && record_id) {
      await admin.from("posts").update({ photo_url: null }).eq("id", record_id);
    }

    // Write to audit log
    await admin.from("admin_audit_log").insert({
      action:      "photo_moderation_flagged",
      target_type: record_type ?? "unknown",
      target_id:   record_id   ?? null,
      details: {
        bucket,
        path,
        reasons:    uniqueReasons,
        labels:     ModerationLabels.map((l) => ({ name: l.Name, confidence: l.Confidence })),
      },
    });

    const message =
      `Your photo was removed because it contains ${uniqueReasons.join(" and ")}. ` +
      `Please upload an appropriate image that follows our community guidelines.`;

    return Response.json(
      { ok: false, flagged: true, reasons: uniqueReasons, message },
      { headers: CORS },
    );
  } catch (err: any) {
    console.error("[moderate-image] unexpected error:", err?.message ?? err);
    return Response.json({ ok: true, flagged: false }, { headers: CORS }); // fail open
  }
});
