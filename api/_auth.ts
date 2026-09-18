import type { SupabaseClient, User } from "@supabase/supabase-js";

export async function requireUser(req: any, res: any, client: SupabaseClient): Promise<User | null> {
  const header = req.headers?.authorization;
  const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token) {
    try {
      const { data, error } = await client.auth.getUser(token);
      if (!error && data.user) return data.user;
    } catch { /* Reject unverifiable credentials. */ }
  }
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: "Sign in to continue." }));
  return null;
}
export async function isTeamMember(client: SupabaseClient, userId: string, teamId: string, captain = false) {
  let query = client.from("team_members").select("user_id").eq("team_id", teamId).eq("user_id", userId);
  if (captain) query = query.eq("role", "captain");
  const { data, error } = await query.maybeSingle();
  return !error && !!data;
}
