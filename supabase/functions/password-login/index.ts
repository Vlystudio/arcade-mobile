import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.0";
import { corsHeaders, handleCors, rejectDisallowedOrigin } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req); if (preflight) return preflight;
  const rejected = rejectDisallowedOrigin(req); if (rejected) return rejected;
  const headers = { ...corsHeaders(req), "Cache-Control": "no-store" };
  const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  let body;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  if (typeof body?.identifier !== "string" || body.identifier.length > 254 || typeof body?.password !== "string" || body.password.length > 1024) {
    return reply(400, { error: "invalid_credentials" });
  }
  const identifier = body.identifier.trim();
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identifier.toLowerCase()));
  const key = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,"0")).join("");
  const quota = await admin.rpc("consume_service_quota", { p_scope: "login:"+key, p_limit: 10, p_seconds: 60 });
  if (quota.error || quota.data !== true) return reply(quota.error ? 503 : 429, { error: "Please try again shortly." });
  let email = identifier;
  if (!identifier.includes("@")) {
    const resolved = await admin.rpc("resolve_login_email", { p_username: identifier });
    if (resolved.error) return reply(503, { error: "Sign-in is temporarily unavailable." });
    // Run the same password authentication path without exposing an email/username mapping.
    email = resolved.data ?? "invalid-user@invalid.example";
  }
  const auth = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email, password: body.password });
  if (error || !data.session) return reply(401, { error: "Incorrect email, username, or password." });
  return reply(200, { access_token: data.session.access_token, refresh_token: data.session.refresh_token });
});
