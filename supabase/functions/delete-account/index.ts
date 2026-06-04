// Supabase Edge Function — delete-account
// Called from src/app/delete-account.tsx after the user re-authenticates
// with their password. The JWT is fresh (< 10 minutes old) because the
// client just signed in to confirm identity.
//
// Steps:
//   1. Verify caller is authenticated via JWT
//   2. Reject if JWT is older than 10 minutes (stale session guard)
//   3. Delete storage files in all user-owned folders
//   4. Soft-anonymize the profile (keep the row for historical scores)
//   5. Hard-delete posts, follows, comments
//   6. Write to admin_audit_log before removing the auth user
//   7. Call auth.admin.deleteUser — invalidates all sessions

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL  = Deno.env.get("SUPABASE_URL")!;
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPA_SVC  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_SESSION_AGE_SECONDS = 600; // 10 minutes

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: CORS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer "))
    return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });

  // Verify the JWT and get the caller's user object
  const userClient = createClient(SUPA_URL, SUPA_ANON, {
    global:  { headers: { Authorization: authHeader } },
    auth:    { persistSession: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });
  }

  // Reject stale sessions — the client must have just re-authenticated
  try {
    const token   = authHeader.slice(7); // strip "Bearer "
    const payload = JSON.parse(atob(token.split(".")[1]));
    const ageSec  = Math.floor(Date.now() / 1000) - (payload.iat as number ?? 0);
    if (ageSec > MAX_SESSION_AGE_SECONDS) {
      return Response.json({
        error:   "session_too_old",
        message: "Please sign in again to confirm account deletion.",
      }, { status: 401, headers: CORS });
    }
  } catch {
    return Response.json({ error: "invalid_token" }, { status: 401, headers: CORS });
  }

  const uid   = user.id;
  const admin = createClient(SUPA_URL, SUPA_SVC, { auth: { persistSession: false } });

  try {
    // ── 1. Delete all storage files for this user ─────────────────────────────
    const BUCKETS = ["avatars", "post-photos", "message-media", "score-proofs"];
    await Promise.all(BUCKETS.map(async (bucket) => {
      const { data: files, error: listErr } = await admin.storage.from(bucket).list(uid);
      if (listErr || !files?.length) return;
      const paths = files.map((f) => `${uid}/${f.name}`);
      const { error: delErr } = await admin.storage.from(bucket).remove(paths);
      if (delErr) console.warn(`[delete-account] storage.remove(${bucket}) error:`, delErr.message);
    }));

    // ── 2. Anonymize the profile (keep row — scores reference it) ─────────────
    const deletedUsername = `deleted_${Date.now()}`;
    await admin.from("profiles").update({
      username:   deletedUsername,
      avatar_url: null,
      bio:        null,
      is_private: true,
    }).eq("id", uid);

    // ── 3. Hard-delete user content ───────────────────────────────────────────
    await Promise.all([
      admin.from("posts").delete().eq("user_id", uid),
      admin.from("follows").delete().or(`follower_id.eq.${uid},following_id.eq.${uid}`),
      admin.from("post_comments").delete().eq("user_id", uid),
    ]);

    // ── 4. Audit log before deleting the auth user ────────────────────────────
    await admin.from("admin_audit_log").insert({
      admin_id:    null,
      action:      "account_deleted",
      target_type: "user",
      target_id:   uid,
      details:     { self_requested: true, deleted_at: new Date().toISOString() },
    });

    // ── 5. Delete the auth user (invalidates all sessions) ───────────────────
    const { error: deleteError } = await admin.auth.admin.deleteUser(uid);
    if (deleteError) {
      console.error("[delete-account] auth.admin.deleteUser error:", deleteError.message);
      return Response.json(
        { error: "delete_failed", message: deleteError.message },
        { status: 500, headers: CORS },
      );
    }

    return Response.json({ ok: true }, { headers: CORS });
  } catch (err: any) {
    console.error("[delete-account] unexpected error:", err?.message ?? err);
    return Response.json(
      { error: "internal_error", message: err?.message ?? "Unknown error" },
      { status: 500, headers: CORS },
    );
  }
});
