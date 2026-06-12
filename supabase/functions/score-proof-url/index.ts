// Supabase Edge Function — score-proof-url
// Generates a short-lived signed URL for a score-proof image during admin
// score review. Replaces client-side createSignedUrl so the score-proofs
// bucket needs NO direct-read storage policy for admins at all.
//
// Authorization is enforced in two layers:
//   1. This function verifies the caller's JWT and requires MFA (aal2).
//   2. The path lookup goes through rpc_admin_create_score_proof_signed_url
//      *as the caller* (anon key + user JWT, not service role), so Postgres
//      re-checks MFA + (platform admin OR venue admin of the score's venue),
//      confirms the score exists and owns the proof path, and writes
//      security_events on denial. Authorization logic lives in SQL only.
//
// Only after the RPC authorizes do we use the service role key — solely to
// sign the storage URL. The raw storage path is never returned to the client.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors, rejectDisallowedOrigin } from "../_shared/cors.ts";

const SUPA_URL  = Deno.env.get("SUPABASE_URL")!;
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPA_SVC  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes — review-time viewing only
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // ── 1. Verify the JWT belongs to a real session ──────────────────────────
  const userClient = createClient(SUPA_URL, SUPA_ANON, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user)
    return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });

  // ── 2. Require MFA (aal2) for all admin proof access ─────────────────────
  try {
    const payload = JSON.parse(atob(authHeader.slice(7).split(".")[1]));
    if (payload.aal !== "aal2") {
      return Response.json({
        error:   "mfa_required",
        message: "Two-factor authentication is required to review score proofs.",
      }, { status: 403, headers: CORS });
    }
  } catch {
    return Response.json({ error: "invalid_token" }, { status: 401, headers: CORS });
  }

  // ── 3. Validate input ─────────────────────────────────────────────────────
  let scoreId: string;
  try {
    const body = await req.json();
    scoreId = String(body?.score_id ?? "");
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400, headers: CORS });
  }
  if (!UUID_RE.test(scoreId))
    return Response.json({ error: "invalid_score_id" }, { status: 400, headers: CORS });

  // ── 4. Authorize via Postgres, AS THE CALLER ─────────────────────────────
  // The RPC enforces require_mfa() + is_admin() OR is_venue_admin(score.venue_id),
  // verifies the score exists with an attached proof, and logs admin_access_denied
  // to security_events on refusal.
  const { data: rpcData, error: rpcError } = await userClient.rpc(
    "rpc_admin_create_score_proof_signed_url",
    { p_score_id: scoreId },
  );
  if (rpcError) {
    // P0003 = require_mfa() raised inside Postgres
    const status = rpcError.code === "P0003" ? 403 : 500;
    return Response.json({ error: "authorization_failed" }, { status, headers: CORS });
  }
  if (rpcData?.error) {
    const status = rpcData.error === "unauthorized" ? 403
                 : rpcData.error === "not_found"   ? 404
                 : 404; // no_proof
    // Pass through the error code but never any path information
    return Response.json({ error: rpcData.error, message: rpcData.message }, { status, headers: CORS });
  }
  if (!rpcData?.path)
    return Response.json({ error: "no_proof" }, { status: 404, headers: CORS });

  // ── 5. Sign with the service role; return ONLY the short-lived URL ───────
  const admin = createClient(SUPA_URL, SUPA_SVC, { auth: { persistSession: false } });
  const { data: signed, error: signError } = await admin.storage
    .from("score-proofs")
    .createSignedUrl(rpcData.path as string, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    console.error("[score-proof-url] sign error:", signError?.message);
    return Response.json({ error: "sign_failed" }, { status: 500, headers: CORS });
  }

  return Response.json({
    ok:         true,
    signed_url: signed.signedUrl,
    expires_in: SIGNED_URL_TTL_SECONDS,
  }, { headers: CORS });
});
