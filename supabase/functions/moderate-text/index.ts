// Supabase Edge Function — moderate-text (OpenAI Moderation API)
// Checks user-generated text for policy violations.
//
// Fail behavior:
//   - DEV  (IS_PRODUCTION != "true"): missing key → skip, log warning
//   - PROD (IS_PRODUCTION == "true"): missing key → reject with 503
//   - Both: API error in prod → return flagged=true to prevent auto-approval
//
// Required env var (Supabase Dashboard → Edge Functions → Secrets):
//   OPENAI_API_KEY
//   IS_PRODUCTION  — set to "true" in production

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const IS_PROD    = Deno.env.get("IS_PRODUCTION") === "true";
const SUPA_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SUPA_SVC   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CATEGORY_LABELS: Record<string, string> = {
  "hate":                   "hate speech",
  "hate/threatening":       "threatening hate speech",
  "harassment":             "harassment",
  "harassment/threatening": "threatening harassment",
  "self-harm":              "self-harm content",
  "self-harm/intent":       "self-harm intent",
  "self-harm/instructions": "self-harm instructions",
  "sexual":                 "sexual content",
  "sexual/minors":          "sexual content involving minors",
  "violence":               "violent content",
  "violence/graphic":       "graphic violence",
};

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function logFailure(reason: string, details: Record<string, unknown> = {}) {
  if (!SUPA_URL || !SUPA_SVC) return;
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const admin = createClient(SUPA_URL, SUPA_SVC, { auth: { persistSession: false } });
    await admin.from("admin_audit_log").insert({
      action: "moderation_service_failure",
      target_type: "moderate-text",
      details: { reason, is_production: IS_PROD, ...details },
    });
  } catch { /* best-effort */ }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: CORS });

  // ── Missing API key ───────────────────────────────────────
  if (!OPENAI_KEY) {
    if (IS_PROD) {
      console.error("[moderate-text] PRODUCTION: OPENAI_API_KEY not configured — rejecting");
      await logFailure("missing_openai_key");
      return Response.json(
        { flagged: false, error: "moderation_unavailable",
          pending_review: true,
          message: "Text moderation is temporarily unavailable. Content held for review." },
        { status: 503, headers: CORS }
      );
    }
    console.warn("[moderate-text] DEV: OPENAI_API_KEY not configured — skipping");
    return Response.json({ flagged: false, skipped: true }, { headers: CORS });
  }

  const { text } = await req.json() as { text: string };
  if (!text?.trim()) return Response.json({ flagged: false }, { headers: CORS });

  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({ input: text }),
    });

    if (!res.ok) {
      console.warn("[moderate-text] OpenAI API error:", res.status);
      if (IS_PROD) {
        // Prod: API error → fail closed (treat as needing review)
        await logFailure("openai_api_error", { status: res.status });
        return Response.json(
          { flagged: false, pending_review: true,
            message: "Text moderation service error. Content held for review." },
          { headers: CORS }
        );
      }
      return Response.json({ flagged: false }, { headers: CORS });
    }

    const data = await res.json();
    const result = data.results?.[0];
    if (!result?.flagged) return Response.json({ flagged: false }, { headers: CORS });

    const triggered = Object.entries(result.categories as Record<string, boolean>)
      .filter(([, v]) => v)
      .map(([k]) => CATEGORY_LABELS[k] ?? k);

    const reason = triggered.length > 0
      ? `Your message was flagged for ${triggered.join(" and ")}. Please revise and try again.`
      : "Your message was flagged by our content filter. Please revise and try again.";

    return Response.json({ flagged: true, reason, categories: triggered }, { headers: CORS });

  } catch (err: any) {
    console.error("[moderate-text] unexpected error:", err?.message ?? err);

    if (IS_PROD) {
      // Prod: unexpected error → fail closed
      await logFailure("unexpected_error", { error: err?.message });
      return Response.json(
        { flagged: false, pending_review: true,
          message: "Text moderation service error. Content held for review." },
        { headers: CORS }
      );
    }

    return Response.json({ flagged: false }, { headers: CORS });
  }
});
