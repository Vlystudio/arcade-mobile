import { createClient } from "@supabase/supabase-js";
import { applyCors, handleCorsPreflight, rejectDisallowedOrigin } from "../_cors";
import { checkRateLimit } from "../_ratelimit";

const supabase = createClient(
  (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sendJson(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * League push notifications. Actions:
 * - schedule_saved (admin JWT): "You play tonight at {slot}" to every member
 *   of every team scheduled for the current week.
 * - round_final (any signed-in user; deduped server-side): placement +
 *   league points to every team in a finalized match. Content comes from
 *   the DB, never the client; matches notify once via notified_at.
 * - weekly_reminder (Vercel cron via CRON_SECRET): same as schedule_saved,
 *   fired automatically on league-night afternoons.
 */
export default async function handler(req: any, res: any) {
  if (handleCorsPreflight(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");

  const authHeader = String(req.headers["authorization"] ?? "");
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  // ── Cron path (Vercel crons send GET with Authorization: Bearer CRON_SECRET) ──
  if (req.method === "GET") {
    if (!process.env.CRON_SECRET || bearer !== process.env.CRON_SECRET) {
      return sendJson(res, 401, { error: "unauthorized" });
    }
    const sent = await notifyWeekSchedule();
    return sendJson(res, 200, { ok: true, sent });
  }

  if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed" });

  const body = parseBody(req.body);
  const action = String(body?.action ?? "");

  // ── User-triggered paths require a valid Supabase JWT ──
  if (rejectDisallowedOrigin(req, res)) return;
  if (!(await checkRateLimit(req, res))) return;

  if (!bearer) return sendJson(res, 401, { error: "unauthorized" });
  const { data: userData, error: userErr } = await supabase.auth.getUser(bearer);
  const caller = userData?.user;
  if (userErr || !caller) return sendJson(res, 401, { error: "unauthorized" });

  if (action === "schedule_saved") {
    const { data: prof } = await supabase.from("profiles").select("role").eq("id", caller.id).maybeSingle();
    if (!["admin", "owner", "architect"].includes(prof?.role ?? "")) {
      return sendJson(res, 403, { error: "forbidden" });
    }
    const sent = await notifyWeekSchedule();
    return sendJson(res, 200, { ok: true, sent });
  }

  if (action === "round_final") {
    const matchId = String(body?.matchId ?? "");
    if (!UUID_RE.test(matchId)) return sendJson(res, 400, { error: "invalid_match" });

    // Dedupe: claim the match atomically; only the first caller sends
    const { data: claimed } = await supabase
      .from("skeeball_league_matches")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", matchId)
      .eq("status", "completed")
      .is("notified_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) return sendJson(res, 200, { ok: true, skipped: "already_notified_or_not_final" });

    const { data: sessions } = await supabase
      .from("skeeball_sessions")
      .select("team_id, placement, league_points, league_points_adjustment, teams(name)")
      .eq("league_match_id", matchId)
      .eq("status", "completed");

    let sent = 0;
    for (const s of sessions ?? []) {
      if (s.placement == null) continue;
      const teamName = (Array.isArray((s as any).teams) ? (s as any).teams[0]?.name : (s as any).teams?.name) ?? "Your team";
      const place = s.placement === 1 ? "1st 🥇" : s.placement === 2 ? "2nd 🥈" : s.placement === 3 ? "3rd 🥉" : `${s.placement}th`;
      const pts = (s.league_points ?? 0) + ((s as any).league_points_adjustment ?? 0);
      sent += await sendToTeams(
        [s.team_id],
        "Round finalized",
        `${teamName} placed ${place} · +${pts} league point${pts === 1 ? "" : "s"}`,
        { type: "round_final", matchId },
      );
    }
    return sendJson(res, 200, { ok: true, sent });
  }

  if (action === "sub_request") {
    const teamId = String(body?.teamId ?? "");
    if (!UUID_RE.test(teamId)) return sendJson(res, 400, { error: "invalid_team" });
    const { data: team } = await supabase.from("teams").select("name").eq("id", teamId).maybeSingle();
    // Notify everyone who opted in as an available sub (excluding that team)
    const { data: subs } = await supabase.from("profiles").select("id").eq("sub_available", true);
    const { data: members } = await supabase.from("team_members").select("user_id").eq("team_id", teamId);
    const memberIds = new Set((members ?? []).map((m: any) => m.user_id));
    let targetIds = (subs ?? []).map((p: any) => p.id).filter((id: string) => !memberIds.has(id));
    targetIds = await filterOptedIn(targetIds, "subs"); // respect "sub requests" mute
    let sent = 0;
    if (targetIds.length) {
      const { data: tokens } = await supabase.from("push_tokens").select("token").in("user_id", targetIds);
      sent = await sendToTokens(
        (tokens ?? []).map((t: any) => t.token),
        "Sub needed 🎳",
        `${team?.name ?? "A team"} needs a sub for Monday night. First come, first serve!`,
        { type: "sub_request", teamId },
      );
    }
    return sendJson(res, 200, { ok: true, sent });
  }

  if (action === "sub_filled") {
    const requestId = String(body?.requestId ?? "");
    if (!UUID_RE.test(requestId)) return sendJson(res, 400, { error: "invalid_request" });
    const { data: reqRow } = await supabase
      .from("sub_requests")
      .select("team_id, filled_by, status")
      .eq("id", requestId)
      .maybeSingle();
    if (!reqRow || reqRow.status !== "filled") return sendJson(res, 200, { ok: true, skipped: true });
    const { data: volunteer } = await supabase.from("profiles").select("username").eq("id", reqRow.filled_by).maybeSingle();
    const sent = await sendToTeams(
      [reqRow.team_id],
      "Sub found ✓",
      `${volunteer?.username ?? "A player"} volunteered to sub for your team Monday night.`,
      { type: "sub_filled", requestId },
    );
    return sendJson(res, 200, { ok: true, sent });
  }

  return sendJson(res, 400, { error: "unknown_action" });
}

/** "You play tonight at {slot}" to members of every team scheduled this week. */
async function notifyWeekSchedule(): Promise<number> {
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const weekOf = monday.toISOString().slice(0, 10);

  const { data: rows } = await supabase
    .from("team_schedule")
    .select("team_id, slot_time, teams(name)")
    .eq("week_of", weekOf);

  let sent = 0;
  for (const r of rows ?? []) {
    const teamName = (Array.isArray((r as any).teams) ? (r as any).teams[0]?.name : (r as any).teams?.name) ?? "Your team";
    sent += await sendToTeams(
      [r.team_id],
      "League night 🎳",
      `${teamName} plays tonight at ${r.slot_time}. Good luck!`,
      { type: "schedule", weekOf },
    );
  }
  return sent;
}

/** Send to an explicit token list (batched). Returns count sent. */
async function sendToTokens(
  list: string[],
  title: string,
  bodyText: string,
  data: Record<string, unknown>,
): Promise<number> {
  const tokens = list.filter(Boolean);
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100).map((to: string) => ({
      to, title, body: bodyText, data, sound: "default", channelId: "default",
    }));
    try {
      const r = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      const result = await r.json().catch(() => null);
      const tickets = result?.data ?? [];
      const dead: string[] = [];
      tickets.forEach((t: any, idx: number) => {
        if (t?.details?.error === "DeviceNotRegistered") dead.push(batch[idx].to);
      });
      if (dead.length) await supabase.from("push_tokens").delete().in("token", dead);
    } catch (err: any) {
      console.error("[push] expo send failed", err?.message ?? err);
    }
  }
  return tokens.length;
}

/** Drop users who muted this notification category (profiles.notif_prefs). */
async function filterOptedIn(userIds: string[], category: string): Promise<string[]> {
  if (!userIds.length || !category) return userIds;
  const { data } = await supabase.from("profiles").select("id, notif_prefs").in("id", userIds);
  const muted = new Set(
    (data ?? []).filter((p: any) => p.notif_prefs && p.notif_prefs[category] === false).map((p: any) => p.id),
  );
  return userIds.filter((id) => !muted.has(id));
}

/** Resolve team members → device tokens → Expo push send. Returns count sent. */
async function sendToTeams(
  teamIds: string[],
  title: string,
  bodyText: string,
  data: Record<string, unknown>,
  category: string = "league",
): Promise<number> {
  const { data: members } = await supabase
    .from("team_members")
    .select("user_id")
    .in("team_id", teamIds);
  let userIds = [...new Set((members ?? []).map((m: any) => m.user_id))];
  userIds = await filterOptedIn(userIds, category);
  if (!userIds.length) return 0;

  const { data: tokens } = await supabase
    .from("push_tokens")
    .select("token")
    .in("user_id", userIds);
  const list = (tokens ?? []).map((t: any) => t.token).filter(Boolean);
  if (!list.length) return 0;

  // Expo push API accepts batches of up to 100 messages
  for (let i = 0; i < list.length; i += 100) {
    const batch = list.slice(i, i + 100).map((to: string) => ({
      to, title, body: bodyText, data, sound: "default", channelId: "default",
    }));
    try {
      const r = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      // Prune tokens Expo reports as dead so we stop sending to them
      const result = await r.json().catch(() => null);
      const tickets = result?.data ?? [];
      const dead: string[] = [];
      tickets.forEach((t: any, idx: number) => {
        if (t?.details?.error === "DeviceNotRegistered") dead.push(batch[idx].to);
      });
      if (dead.length) await supabase.from("push_tokens").delete().in("token", dead);
    } catch (err: any) {
      console.error("[push] expo send failed", err?.message ?? err);
    }
  }
  return list.length;
}

function parseBody(body: unknown): Record<string, any> | null {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch { return null; }
  }
  return typeof body === "object" ? (body as Record<string, any>) : null;
}
