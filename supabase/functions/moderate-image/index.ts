// Supabase Edge Function — moderate-image (AWS Rekognition)
// Called after every photo upload. Downloads the image and sends it to
// AWS Rekognition DetectModerationLabels.
//
// Fail behavior:
//   - DEV  (IS_PRODUCTION != "true"): missing keys → skip, log warning
//   - PROD (IS_PRODUCTION == "true"): missing keys → reject with 503
//   - Both: AWS API error in prod → mark content pending_review (fail closed)
//
// Required env vars (Supabase Dashboard → Edge Functions → Secrets):
//   AWS_ACCESS_KEY_ID      — IAM user with rekognition:DetectModerationLabels
//   AWS_SECRET_ACCESS_KEY  — IAM user secret
//   AWS_REGION             — e.g. us-east-1
//   IS_PRODUCTION          — set to "true" in production

import { createClient }                                from "https://esm.sh/@supabase/supabase-js@2";
import { RekognitionClient, DetectModerationLabelsCommand } from "https://esm.sh/@aws-sdk/client-rekognition@3";

const AWS_KEY    = Deno.env.get("AWS_ACCESS_KEY_ID")     ?? "";
const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") ?? "";
const AWS_REGION = Deno.env.get("AWS_REGION")            ?? "us-east-1";
const SUPA_URL   = Deno.env.get("SUPABASE_URL")!;
const SUPA_SVC   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IS_PROD    = Deno.env.get("IS_PRODUCTION") === "true";

const MIN_CONFIDENCE = 70;

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

async function logModerationFailure(
  admin: ReturnType<typeof createClient>,
  reason: string,
  details: Record<string, unknown>
) {
  try {
    await admin.from("admin_audit_log").insert({
      action:      "moderation_service_failure",
      target_type: "moderate-image",
      details:     { reason, ...details },
    });
  } catch { /* best-effort */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: CORS });

  // ── Missing credentials ───────────────────────────────────
  if (!AWS_KEY || !AWS_SECRET) {
    if (IS_PROD) {
      // Production: fail closed — do not allow content through
      console.error("[moderate-image] PRODUCTION: AWS credentials not configured — rejecting");
      const admin = createClient(SUPA_URL, SUPA_SVC, { auth: { persistSession: false } });
      await logModerationFailure(admin, "missing_aws_credentials", { is_production: true });
      return Response.json(
        { ok: false, flagged: false, error: "moderation_unavailable",
          message: "Content moderation is temporarily unavailable. Please try again later." },
        { status: 503, headers: CORS }
      );
    }
    // Dev: warn and allow
    console.warn("[moderate-image] DEV: AWS credentials not configured — skipping moderation");
    return Response.json({ ok: true, flagged: false, skipped: true }, { headers: CORS });
  }

  const body = await req.json() as {
    image_url:   string;
    bucket:      string;
    path:        string;
    record_type: "avatar" | "post" | "score_proof" | "team_photo" | string;
    record_id:   string;
  };

  const { image_url, bucket, path, record_type, record_id } = body;

  if (!image_url) {
    return Response.json({ error: "image_url required" }, { status: 400, headers: CORS });
  }

  const admin = createClient(SUPA_URL, SUPA_SVC, { auth: { persistSession: false } });

  try {
    const imgRes = await fetch(image_url);
    if (!imgRes.ok) {
      console.warn("[moderate-image] Could not fetch image:", imgRes.status);
      if (IS_PROD) {
        // Prod: can't fetch image → mark pending_review
        await setPendingReview(admin, record_type, record_id, "image_fetch_failed");
        await logModerationFailure(admin, "image_fetch_failed",
          { bucket, path, record_type, record_id, status: imgRes.status });
        return Response.json(
          { ok: false, flagged: false, pending_review: true,
            message: "Image could not be verified. Content held for manual review." },
          { headers: CORS }
        );
      }
      return Response.json({ ok: true, flagged: false }, { headers: CORS });
    }
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());

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

    const reasons = new Set<string>();
    for (const label of ModerationLabels) {
      const name = label.Name ?? "";
      if (BLOCK_LABELS[name]) reasons.add(BLOCK_LABELS[name]);
    }

    if (reasons.size === 0) {
      return Response.json({ ok: true, flagged: false }, { headers: CORS });
    }

    const uniqueReasons = [...reasons];

    // Flagged — remove file and revert DB record
    if (bucket && path) {
      const { error: delErr } = await admin.storage.from(bucket).remove([path]);
      if (delErr) console.error("[moderate-image] storage delete error:", delErr.message);
    }

    if (record_type === "avatar" && record_id) {
      await admin.from("profiles").update({ avatar_url: null }).eq("id", record_id);
    } else if (record_type === "post" && record_id) {
      await admin.from("posts").update({ photo_url: null }).eq("id", record_id);
    } else if (record_type === "score_proof" && record_id) {
      await admin.from("scores").update({ proof_storage_path: null }).eq("id", record_id);
    } else if (record_type === "team_photo" && record_id) {
      await admin.from("teams").update({ photo_url: null }).eq("id", record_id);
    }

    await admin.from("admin_audit_log").insert({
      action:      "photo_moderation_flagged",
      target_type: record_type ?? "unknown",
      target_id:   record_id   ?? null,
      details: {
        bucket, path,
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

    if (IS_PROD) {
      // Production: external service error → fail closed, hold for review
      try {
        await setPendingReview(admin, record_type, record_id, "rekognition_error");
        await logModerationFailure(admin, "rekognition_error",
          { bucket, path, record_type, record_id, error: err?.message });
      } catch { /* best-effort */ }
      return Response.json(
        { ok: false, flagged: false, pending_review: true,
          message: "Content moderation service error. Content held for manual review." },
        { headers: CORS }
      );
    }

    // Dev: allow through
    return Response.json({ ok: true, flagged: false }, { headers: CORS });
  }
});

async function setPendingReview(
  admin: ReturnType<typeof createClient>,
  record_type: string,
  record_id: string,
  reason: string
) {
  if (!record_id) return;
  const details = { moderation_hold: true, hold_reason: reason };
  if (record_type === "post") {
    await admin.from("posts").update({ status: "pending_review" } as any).eq("id", record_id);
  } else if (record_type === "score_proof") {
    await admin.from("scores").update({ status: "pending" }).eq("id", record_id);
  }
  await admin.from("admin_audit_log").insert({
    action: "moderation_hold", target_type: record_type, target_id: record_id,
    details,
  });
}
