// Supabase Edge Function — moderate-image
// Called after every photo upload. Checks the image with Sightengine for
// nudity, hate symbols, gore, and offensive content.
// If flagged: deletes the file from storage, reverts the DB record, logs to
// admin_audit_log, and returns { flagged: true, message: "..." } so the
// client can show the user a warning.
// Fails open — if credentials are missing or the API is unavailable the
// upload is allowed through so the app keeps working.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SE_USER    = Deno.env.get("SIGHTENGINE_API_USER")    ?? "";
const SE_SECRET  = Deno.env.get("SIGHTENGINE_API_SECRET")  ?? "";
const SUPA_URL   = Deno.env.get("SUPABASE_URL")!;
const SUPA_SVC   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Confidence thresholds (0–1). Lower = more sensitive.
const T = {
  sexual_activity:  0.40,
  sexual_display:   0.40,
  erotica:          0.50,
  suggestive:       0.75,
  offensive:        0.60,   // hate symbols, hate speech imagery
  gore:             0.55,   // blood, gore, graphic violence
};

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: CORS });

  // Skip gracefully when credentials not set (dev / CI environments)
  if (!SE_USER || !SE_SECRET) {
    console.warn("[moderate-image] Sightengine credentials not configured — skipping");
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
    // ── Call Sightengine ──────────────────────────────────────────────────────
    const seUrl = new URL("https://api.sightengine.com/1.0/check.json");
    seUrl.searchParams.set("url",        image_url);
    seUrl.searchParams.set("models",     "nudity-2.1,offensive,gore");
    seUrl.searchParams.set("api_user",   SE_USER);
    seUrl.searchParams.set("api_secret", SE_SECRET);

    const seRes  = await fetch(seUrl.toString());
    const seData = await seRes.json() as any;

    if (seData.status !== "success") {
      console.error("[moderate-image] Sightengine error:", JSON.stringify(seData));
      return Response.json({ ok: true, flagged: false }, { headers: CORS }); // fail open
    }

    // ── Score evaluation ──────────────────────────────────────────────────────
    const n       = seData.nudity  ?? {};
    const reasons: string[] = [];

    if ((n.sexual_activity ?? 0) > T.sexual_activity) reasons.push("explicit sexual content");
    if ((n.sexual_display  ?? 0) > T.sexual_display)  reasons.push("explicit sexual content");
    if ((n.erotica         ?? 0) > T.erotica)         reasons.push("explicit sexual content");
    if ((n.suggestive      ?? 0) > T.suggestive)      reasons.push("suggestive content");
    if ((seData.offensive?.prob ?? 0) > T.offensive)  reasons.push("offensive or hateful imagery");
    if ((seData.gore?.prob       ?? 0) > T.gore)      reasons.push("graphic violence or gore");

    const uniqueReasons = [...new Set(reasons)];

    if (uniqueReasons.length === 0) {
      return Response.json({ ok: true, flagged: false }, { headers: CORS });
    }

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
        reasons:  uniqueReasons,
        scores: {
          nudity:    n,
          offensive: seData.offensive,
          gore:      seData.gore,
        },
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
