import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../../lib/supabase";

export type InboxItem = {
  id: string;
  type: "invite" | "join_request" | "friend_request" | "round_result" | "sub_filled" | "broadcast";
  icon: string;
  color: string;
  title: string;
  body: string | null;
  created_at: string;
  /** Navigation hint for the inbox screen */
  route: { pathname: string; params?: Record<string, string> } | null;
};

const SEEN_KEY = "inbox_last_seen";

/**
 * Builds the activity inbox by merging existing tables — no extra
 * notification storage needed. Newest first.
 */
export async function fetchInbox(userId: string): Promise<InboxItem[]> {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();

  const [invitesRes, captainTeamsRes, friendReqRes, myTeamsRes, broadcastsRes] = await Promise.all([
    supabase
      .from("team_requests")
      .select("id, team_id, created_at, teams(name)")
      .eq("user_id", userId).eq("direction", "invite").eq("status", "pending"),
    supabase.from("teams").select("id, name").eq("captain_user_id", userId),
    supabase
      .from("friendships")
      .select("id, requester_id, created_at")
      .eq("addressee_id", userId).eq("status", "pending"),
    supabase.from("team_members").select("team_id, teams(name)").eq("user_id", userId),
    supabase
      .from("app_announcements")
      .select("id, title, body, created_at")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  const items: InboxItem[] = [];
  const teamName = (t: any) => (Array.isArray(t) ? t[0]?.name : t?.name) ?? "a team";

  for (const r of invitesRes.data ?? []) {
    items.push({
      id: `inv_${(r as any).id}`,
      type: "invite",
      icon: "person-add",
      color: "#06b6d4",
      title: `${teamName((r as any).teams)} invited you to join`,
      body: "Accept or decline on the Teams tab.",
      created_at: (r as any).created_at,
      route: { pathname: "/teams" },
    });
  }

  // Join requests for teams I captain
  const captainTeams = captainTeamsRes.data ?? [];
  if (captainTeams.length) {
    const { data: reqs } = await supabase
      .from("team_requests")
      .select("id, team_id, user_id, created_at")
      .in("team_id", captainTeams.map((t: any) => t.id))
      .eq("status", "pending").eq("direction", "request");
    const reqUserIds = [...new Set((reqs ?? []).map((r: any) => r.user_id))];
    let names: Record<string, string> = {};
    if (reqUserIds.length) {
      const { data: profs } = await supabase.from("public_profiles").select("id, username").in("id", reqUserIds);
      for (const p of profs ?? []) names[(p as any).id] = (p as any).username ?? "Someone";
    }
    for (const r of reqs ?? []) {
      const team = captainTeams.find((t: any) => t.id === (r as any).team_id);
      items.push({
        id: `req_${(r as any).id}`,
        type: "join_request",
        icon: "people",
        color: "#f59e0b",
        title: `${names[(r as any).user_id] ?? "Someone"} wants to join ${team?.name ?? "your team"}`,
        body: "Review it in your team's settings (gear icon).",
        created_at: (r as any).created_at,
        route: team ? { pathname: "/team-detail", params: { teamId: team.id, teamName: team.name } } : null,
      });
    }
  }

  // Friend requests
  const reqIds = (friendReqRes.data ?? []).map((f: any) => f.requester_id);
  let friendNames: Record<string, string> = {};
  if (reqIds.length) {
    const { data: profs } = await supabase.from("public_profiles").select("id, username").in("id", reqIds);
    for (const p of profs ?? []) friendNames[(p as any).id] = (p as any).username ?? "Someone";
  }
  for (const f of friendReqRes.data ?? []) {
    items.push({
      id: `fr_${(f as any).id}`,
      type: "friend_request",
      icon: "person-add-outline",
      color: "#a855f7",
      title: `${friendNames[(f as any).requester_id] ?? "Someone"} sent you a friend request`,
      body: null,
      created_at: (f as any).created_at,
      route: { pathname: "/friends" },
    });
  }

  // Recent round results + filled subs for my teams
  const myTeamIds = (myTeamsRes.data ?? []).map((t: any) => t.team_id);
  if (myTeamIds.length) {
    const [sessRes, subsRes] = await Promise.all([
      supabase
        .from("skeeball_sessions")
        .select("id, team_id, placement, league_points, completed_at, teams(name)")
        .in("team_id", myTeamIds)
        .eq("status", "completed")
        .not("placement", "is", null)
        .gte("completed_at", since),
      supabase
        .from("sub_requests")
        .select("id, team_id, created_at, filled_by, teams(name)")
        .in("team_id", myTeamIds)
        .eq("status", "filled")
        .gte("created_at", since),
    ]);
    for (const ss of sessRes.data ?? []) {
      const place = (ss as any).placement;
      const medal = place === 1 ? "🥇 1st" : place === 2 ? "🥈 2nd" : place === 3 ? "🥉 3rd" : `${place}th`;
      const team = (myTeamsRes.data ?? []).find((t: any) => t.team_id === (ss as any).team_id);
      items.push({
        id: `res_${(ss as any).id}`,
        type: "round_result",
        icon: "trophy",
        color: "#22c55e",
        title: `${teamName((ss as any).teams)} placed ${medal}`,
        body: `+${(ss as any).league_points ?? 0} league points`,
        created_at: (ss as any).completed_at,
        route: team
          ? { pathname: "/team-detail", params: { teamId: (ss as any).team_id, teamName: teamName((ss as any).teams) } }
          : null,
      });
    }
    for (const sr of subsRes.data ?? []) {
      items.push({
        id: `sub_${(sr as any).id}`,
        type: "sub_filled",
        icon: "hand-left",
        color: "#f59e0b",
        title: `A sub volunteered for ${teamName((sr as any).teams)}`,
        body: "You're covered for league night.",
        created_at: (sr as any).created_at,
        route: { pathname: "/team-detail", params: { teamId: (sr as any).team_id, teamName: teamName((sr as any).teams) } },
      });
    }
  }

  for (const a of broadcastsRes.data ?? []) {
    items.push({
      id: `bc_${(a as any).id}`,
      type: "broadcast",
      icon: "megaphone",
      color: "#f59e0b",
      title: (a as any).title,
      body: (a as any).body,
      created_at: (a as any).created_at,
      route: null,
    });
  }

  return items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 50);
}

export async function unseenInboxCount(items: InboxItem[]): Promise<number> {
  const lastSeen = await AsyncStorage.getItem(SEEN_KEY);
  if (!lastSeen) return items.length;
  return items.filter((i) => i.created_at > lastSeen).length;
}

export async function markInboxSeen() {
  await AsyncStorage.setItem(SEEN_KEY, new Date().toISOString());
}
