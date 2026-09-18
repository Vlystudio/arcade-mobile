import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { corsHeaders, handleCors, rejectDisallowedOrigin } from "../_shared/cors.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req); if (preflight) return preflight;
  const rejected = rejectDisallowedOrigin(req); if (rejected) return rejected;
  const headers = corsHeaders(req);
  const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return reply(401, { error: "unauthorized" });
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user?.email) return reply(401, { error: "unauthorized" });
  let body;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  if (typeof body?.password !== "string" || body.password.length > 1024) return reply(400, { error: "password_required" });
  // Require the existing session's second factor when the account has MFA enrolled.
  // The JWT was verified by getUser above; decode only to inspect its assurance level.
  let claims;
  try { claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); }
  catch { return reply(401, { error: "invalid_token" }); }
  if (user.factors?.some((factor) => factor.status === "verified") && claims.aal !== "aal2") {
    return reply(403, { error: "mfa_required", message: "Verify your second factor before deleting your account." });
  }
  // Verify the actual password on the server. A recently refreshed JWT is not proof of reauthentication.
  const proof = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await proof.auth.signInWithPassword({ email: user.email, password: body.password });
  if (verified.error || verified.data.user?.id !== user.id) return reply(401, { error: "reauthentication_failed", message: "Incorrect password." });
  await proof.auth.signOut({ scope: "local" });
  const uid = user.id;
  try {
    const { error: jobError } = await admin.from("account_deletion_jobs").upsert({ user_id: uid, stage: "storage", updated_at: new Date().toISOString() });
    if (jobError) throw jobError;
    // Query objects by ownership, including nested folders and conversation-scoped paths.
    // Always consume page zero because successfully removed objects disappear from the inventory.
    for (let batch = 0; batch < 100; batch++) {
      const { data: objects, error: inventoryError } = await admin.rpc("account_storage_inventory", { p_user_id: uid, p_limit: 100 });
      if (inventoryError) throw inventoryError;
      if (!objects?.length) break;
      const grouped = new Map<string, string[]>();
      for (const object of objects) {
        grouped.set(object.bucket_id, [...(grouped.get(object.bucket_id) ?? []), object.name]);
      }
      for (const [bucket, paths] of grouped) {
        const { error: removeError } = await admin.storage.from(bucket).remove(paths);
        if (removeError) throw removeError;
      }
      if (batch === 99) throw new Error("More files remain; retry to continue cleanup.");
    }
    const { error: cleanupError } = await admin.rpc("delete_account_data", { p_user_id: uid });
    if (cleanupError) throw cleanupError;
    // Revoke refresh sessions before removing Auth. Access JWTs can remain valid until expiry;
    // sensitive handlers always verify a live user, and row policies must retain ownership checks.
    const { error: revokeError } = await admin.auth.admin.signOut(token, "global");
    if (revokeError) throw revokeError;
    const { error: deleteError } = await admin.auth.admin.deleteUser(uid);
    if (deleteError) throw deleteError;
    const { error: completeError } = await admin.from("account_deletion_jobs").update({ stage: "complete", updated_at: new Date().toISOString() }).eq("user_id", uid);
    if (completeError) console.error("Deletion audit completion failed", completeError.message);
    return reply(200, { ok: true });
  } catch (failure) {
    console.error("Account deletion incomplete", failure instanceof Error ? failure.message : "database_or_storage_failure");
    return reply(500, { error: "delete_incomplete", message: "Deletion is incomplete. Sign in and retry to continue cleanup." });
  }
});
