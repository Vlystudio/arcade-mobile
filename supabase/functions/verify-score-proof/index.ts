// Supabase Edge Function — verify-score-proof
// AI verification of score-proof photos against the admin-set reference
// photo for the game. CONSERVATIVE launch: in 'deny_only' mode the AI can
// only auto-DENY blatant mismatches (wrong machine, or the display clearly
// shows a different score). Everything else stays 'pending' with the AI's
// reading attached as a hint for the human review queue. 'full_auto' mode
// (admin-switchable later) additionally auto-approves high-confidence
// matches.
//
// Called by the score owner right after attaching their proof. All heavy
// access (reference photo, proof image, score update) uses the service
// role; the caller's JWT only proves they own the score.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors, rejectDisallowedOrigin } from "../_shared/cors.ts";

const SUPA_URL  = Deno.env.get("SUPABASE_URL")!;
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPA_SVC  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Anthropic preferred when configured; OpenAI vision as fallback (the
// project's moderate-text secret already provides OPENAI_API_KEY).
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_KEY    = Deno.env.get("OPENAI_API_KEY");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deny thresholds — deliberately strict so false denials are rare.
const DENY_MACHINE_CONFIDENCE = 0.85;  // "definitely not this machine"
const DENY_SCORE_CONFIDENCE   = 0.85;  // "display clearly reads a different score"
const SCORE_TOLERANCE         = 0.02;  // 2% — display rounding / trailing-zero quirks

async function downloadAsBase64(admin: any, bucket: string, path: string): Promise<{ b64: string; mime: string } | null> {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) return null;
  const buf = new Uint8Array(await data.arrayBuffer());
  if (buf.byteLength > 4_500_000) return null; // stay under model limits
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  const mime = data.type && data.type.startsWith("image/") ? data.type : "image/jpeg";
  return { b64: btoa(bin), mime };
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const rejectedOrigin = rejectDisallowedOrigin(req);
  if (rejectedOrigin) return rejectedOrigin;
  const CORS = corsHeaders(req);

  if (req.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: CORS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer "))
    return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });

  const userClient = createClient(SUPA_URL, SUPA_ANON, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user)
    return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });

  let scoreId = "";
  try {
    const body = await req.json();
    scoreId = String(body?.score_id ?? "");
  } catch { /* fallthrough */ }
  if (!UUID_RE.test(scoreId))
    return Response.json({ error: "invalid_score_id" }, { status: 400, headers: CORS });

  const admin = createClient(SUPA_URL, SUPA_SVC, { auth: { persistSession: false } });

  const setVerdict = async (fields: Record<string, unknown>) => {
    await admin.from("scores").update({ ...fields, ai_checked_at: new Date().toISOString() }).eq("id", scoreId);
  };

  try {
    // ── Load + authorize ────────────────────────────────────────────────
    const { data: score } = await admin
      .from("scores")
      .select("id, user_id, game_id, score, status, proof_storage_path, ai_checked_at")
      .eq("id", scoreId)
      .maybeSingle();

    if (!score || score.user_id !== user.id)
      return Response.json({ error: "not_found" }, { status: 404, headers: CORS });
    if (score.status !== "pending" || !score.proof_storage_path || score.ai_checked_at)
      return Response.json({ ok: true, skipped: true }, { headers: CORS });

    const { data: cfg } = await admin.from("ai_verification_config").select("mode").eq("id", 1).maybeSingle();
    const mode = cfg?.mode ?? "deny_only";
    if (mode === "off")
      return Response.json({ ok: true, skipped: true }, { headers: CORS });

    // No reference photo for this game → manual review, annotate and exit.
    const { data: ref } = await admin
      .from("game_reference_photos")
      .select("storage_path")
      .eq("game_id", score.game_id)
      .maybeSingle();
    if (!ref) {
      await setVerdict({ ai_verdict: "no_reference" });
      return Response.json({ ok: true, verdict: "no_reference" }, { headers: CORS });
    }

    if (!ANTHROPIC_KEY && !OPENAI_KEY) {
      await setVerdict({ ai_verdict: "error", ai_reasoning: "no vision API key configured" });
      return Response.json({ ok: true, verdict: "error" }, { headers: CORS });
    }

    const [refImg, proofImg] = await Promise.all([
      downloadAsBase64(admin, "game-references", ref.storage_path),
      downloadAsBase64(admin, "score-proofs", score.proof_storage_path),
    ]);
    if (!refImg || !proofImg) {
      await setVerdict({ ai_verdict: "error", ai_reasoning: "could not load images" });
      return Response.json({ ok: true, verdict: "error" }, { headers: CORS });
    }

    // ── Vision check ────────────────────────────────────────────────────
    const instructions =
`The player claims a score of ${score.score}.

Answer ONLY with strict JSON, no markdown:
{
  "same_machine": boolean,        // does image 2 show the same game/machine type & score display as image 1?
  "machine_confidence": number,   // 0-1
  "displayed_score": number|null, // the score you can read on image 2's display, null if unreadable
  "score_confidence": number,     // 0-1 confidence in your reading (0 if null)
  "reasoning": string             // one or two short sentences
}

Be conservative: if lighting/angle makes you unsure, lower the confidence rather than guessing. Treat photos of phone/computer screens showing a picture of a machine as suspicious (mention it in reasoning).`;

    let rawText = "";
    if (ANTHROPIC_KEY) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "IMAGE 1 — the venue's REFERENCE photo of this arcade game's score display:" },
              { type: "image", source: { type: "base64", media_type: refImg.mime, data: refImg.b64 } },
              { type: "text", text: "IMAGE 2 — a player's score-proof photo:" },
              { type: "image", source: { type: "base64", media_type: proofImg.mime, data: proofImg.b64 } },
              { type: "text", text: instructions },
            ],
          }],
        }),
      });
      if (!r.ok) {
        console.error("[verify-score-proof] anthropic error", r.status, (await r.text()).slice(0, 200));
        await setVerdict({ ai_verdict: "error", ai_reasoning: `vision call failed (${r.status})` });
        return Response.json({ ok: true, verdict: "error" }, { headers: CORS });
      }
      const ai = await r.json();
      rawText = ai.content?.[0]?.text ?? "";
    } else {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 400,
          response_format: { type: "json_object" },
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "IMAGE 1 — the venue's REFERENCE photo of this arcade game's score display:" },
              { type: "image_url", image_url: { url: `data:${refImg.mime};base64,${refImg.b64}` } },
              { type: "text", text: "IMAGE 2 — a player's score-proof photo:" },
              { type: "image_url", image_url: { url: `data:${proofImg.mime};base64,${proofImg.b64}` } },
              { type: "text", text: instructions },
            ],
          }],
        }),
      });
      if (!r.ok) {
        console.error("[verify-score-proof] openai error", r.status, (await r.text()).slice(0, 200));
        await setVerdict({ ai_verdict: "error", ai_reasoning: `vision call failed (${r.status})` });
        return Response.json({ ok: true, verdict: "error" }, { headers: CORS });
      }
      const ai = await r.json();
      rawText = ai.choices?.[0]?.message?.content ?? "";
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    } catch { /* fallthrough */ }
    if (!parsed || typeof parsed.same_machine !== "boolean") {
      await setVerdict({ ai_verdict: "error", ai_reasoning: "unparseable vision response" });
      return Response.json({ ok: true, verdict: "error" }, { headers: CORS });
    }

    const machineConf = Number(parsed.machine_confidence ?? 0);
    const scoreConf   = Number(parsed.score_confidence ?? 0);
    const readScore   = parsed.displayed_score === null ? null : Number(parsed.displayed_score);
    const reasoning   = String(parsed.reasoning ?? "").slice(0, 500);

    const scoreMismatch =
      readScore !== null && Number.isFinite(readScore) &&
      Math.abs(readScore - Number(score.score)) > Math.max(Number(score.score), readScore) * SCORE_TOLERANCE;

    const wrongMachine = parsed.same_machine === false && machineConf >= DENY_MACHINE_CONFIDENCE;
    const clearScoreLie = scoreMismatch && scoreConf >= DENY_SCORE_CONFIDENCE;

    const matches = parsed.same_machine === true && readScore !== null && !scoreMismatch;

    const base = {
      ai_confidence: Math.min(machineConf, scoreConf || machineConf),
      ai_read_score: readScore !== null && Number.isFinite(readScore) ? Math.round(readScore) : null,
      ai_reasoning: reasoning,
    };

    if (wrongMachine || clearScoreLie) {
      // ── Auto-deny (both modes) ──
      await setVerdict({ ...base, ai_verdict: "auto_denied" });
      await admin.from("scores").update({ status: "denied" }).eq("id", scoreId);
      await admin.from("admin_audit_log").insert({
        admin_id: null,
        action: "ai_score_auto_denied",
        target_type: "score",
        target_id: scoreId,
        details: {
          claimed: score.score, read: readScore,
          wrong_machine: wrongMachine, reasoning,
        },
      });
      const message = wrongMachine
        ? "Your proof photo doesn't appear to show this game's score display. Take a fresh photo of the machine and resubmit."
        : `The display in your photo reads ${readScore?.toLocaleString()}, which doesn't match the score you entered. Double-check and resubmit.`;
      return Response.json({ ok: true, verdict: "auto_denied", message }, { headers: CORS });
    }

    if (matches && machineConf >= 0.85 && scoreConf >= 0.85 && mode === "full_auto") {
      // ── Auto-approve (only after the flag is flipped) ──
      await setVerdict({ ...base, ai_verdict: "looks_good" });
      await admin.from("scores").update({ status: "approved" }).eq("id", scoreId);
      await admin.from("admin_audit_log").insert({
        admin_id: null,
        action: "ai_score_auto_approved",
        target_type: "score",
        target_id: scoreId,
        details: { claimed: score.score, read: readScore, reasoning },
      });
      return Response.json({ ok: true, verdict: "auto_approved" }, { headers: CORS });
    }

    // ── Otherwise: human queue, annotated ──
    await setVerdict({ ...base, ai_verdict: matches ? "looks_good" : "needs_review" });
    return Response.json({ ok: true, verdict: matches ? "looks_good" : "needs_review" }, { headers: CORS });
  } catch (err: any) {
    console.error("[verify-score-proof] unexpected:", err?.message ?? err);
    try { await setVerdict({ ai_verdict: "error", ai_reasoning: "internal error" }); } catch { /* noop */ }
    return Response.json({ ok: true, verdict: "error" }, { headers: CORS });
  }
});
