import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/avatar";
import BottomTabBar from "../components/bottom-tab-bar";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type MainTab = "reviews" | "stats" | "health" | "teams" | "tournaments" | "users" | "forums" | "scheduler";
type ReviewTab = "pending" | "approved" | "denied";

type ReviewScore = {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  game_name: string;
  score: number;
  photo_url: string | null;
  created_at: string;
};

type ConfirmAction = {
  score: ReviewScore;
  toStatus: "approved" | "denied";
  title: string;
  body: string;
  btnLabel: string;
  btnColor: string;
  btnTextColor: string;
};

type StatsData = {
  pending: number;
  approved: number;
  denied: number;
  today: number;
  gameBreakdown: Array<{ type: string; label: string; count: number }>;
  topPlayers: Array<{ username: string; avatar_url: string | null; game_count: number; best_score: number }>;
};

type HealthData = {
  totalUsers: number;
  newUsersWeek: number;
  activePlayersWeek: number;
  scoresToday: number;
  pendingQueue: number;
  approvalRate: number;
};

type AdminTeam = {
  id: string;
  name: string;
  captain_username: string;
  member_count: number;
  created_at: string;
};

type TournamentRequest = {
  id: string;
  user_id: string;
  username: string;
  title: string;
  description: string | null;
  game_type: string | null;
  proposed_date: string | null;
  max_teams: number;
  status: "pending" | "approved" | "denied";
  created_at: string;
};

type ManageTournament = {
  id: string;
  title: string;
  game_type: string | null;
  status: string;
  proposed_date: string | null;
  is_official: boolean;
  created_at: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_TABS: { key: MainTab; label: string; icon: string }[] = [
  { key: "reviews",     label: "Reviews",     icon: "checkmark-done-outline" },
  { key: "stats",       label: "Stats",       icon: "bar-chart-outline" },
  { key: "health",      label: "Health",      icon: "pulse-outline" },
  { key: "teams",       label: "Teams",       icon: "people-outline" },
  { key: "scheduler",  label: "Schedule",    icon: "calendar-outline" },
  { key: "tournaments", label: "Tourneys",    icon: "trophy-outline" },
  { key: "forums",      label: "Forums",      icon: "chatbubbles-outline" },
  { key: "users",       label: "Users",       icon: "person-outline" },
];

const SCHED_SLOTS = ["6:00 PM", "7:15 PM", "8:30 PM"] as const;
const MAX_TEAMS_PER_SLOT = 8;

type SchedulerTeam = {
  id: string;
  name: string;
  slot_pref_1: string | null;
  slot_pref_2: string | null;
  avg_score: number;
};

const REVIEW_TABS: ReviewTab[] = ["pending", "approved", "denied"];

const PLACEMENT_LABELS = ["🥇 1st", "🥈 2nd", "🥉 3rd", "4th", "5th", "6th", "7th", "8th"];
const MANAGE_STATUS_COLORS: Record<string, string> = {
  upcoming: "#06b6d4", active: "#22c55e", completed: "#555", cancelled: "#ef4444",
};

const REVIEW_EMPTY: Record<ReviewTab, { title: string; sub: string; icon: string; color: string }> = {
  pending:  { title: "All caught up!",      sub: "No pending scores to review.", icon: "checkmark-done-circle-outline", color: "#22c55e" },
  approved: { title: "Nothing approved yet", sub: "Approved scores appear here.", icon: "checkmark-circle-outline",      color: "#06b6d4" },
  denied:   { title: "No denied scores",     sub: "Denied scores appear here.",   icon: "close-circle-outline",           color: "#ef4444" },
};

const TYPE_LABELS: Record<string, string> = {
  skeeball:   "Skee-Ball",
  pinball:    "Pinball",
  arcade:     "Arcade",
  basketball: "Basketball",
  airhockey:  "Air Hockey",
  pool:       "Pool",
};

const TYPE_COLORS: Record<string, string> = {
  skeeball:   "#06b6d4",
  pinball:    "#a855f7",
  arcade:     "#f59e0b",
  basketball: "#ef4444",
  airhockey:  "#22c55e",
  pool:       "#3b82f6",
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AdminScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [userRole, setUserRole] = useState<string>("user");
  const [checking, setChecking] = useState(true);

  // Users tab state
  type UserProfile = { id: string; username: string; avatar_url: string | null; role: string; email?: string };
  const [usersData, setUsersData] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [roleChanging, setRoleChanging] = useState<string | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);

  // Main navigation
  const [mainTab, setMainTab] = useState<MainTab>("reviews");

  // Reviews state
  const [reviewTab, setReviewTab] = useState<ReviewTab>("pending");
  const [scores, setScores] = useState<ReviewScore[]>([]);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [reviewRefreshing, setReviewRefreshing] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [photoModal, setPhotoModal] = useState<string | null>(null);

  // Stats state
  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Health state
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Teams state
  const [adminTeams, setAdminTeams] = useState<AdminTeam[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [deleteTeamTarget, setDeleteTeamTarget] = useState<AdminTeam | null>(null);
  const [deletingTeam, setDeletingTeam] = useState(false);

  // Tournaments — requests
  const [tournRequests, setTournRequests] = useState<TournamentRequest[]>([]);
  const [tournTab, setTournTab] = useState<"pending" | "approved" | "denied" | "manage">("pending");
  const [tournLoading, setTournLoading] = useState(false);
  const [actioning_tourn, setActioningTourn] = useState<string | null>(null);
  const [denyNoteTarget, setDenyNoteTarget] = useState<TournamentRequest | null>(null);
  const [denyNote, setDenyNote] = useState("");

  // Tournaments — manage
  const [manageTournaments, setManageTournaments] = useState<ManageTournament[]>([]);
  const [manageLoading, setManageLoading] = useState(false);
  const [statusActioning, setStatusActioning] = useState<string | null>(null);
  const [firstFridayCreating, setFirstFridayCreating] = useState(false);
  const [resultsTarget, setResultsTarget] = useState<ManageTournament | null>(null);
  const [resultEntries, setResultEntries] = useState<{ place: number; username: string }[]>([
    { place: 1, username: "" }, { place: 2, username: "" }, { place: 3, username: "" },
  ]);
  const [savingResults, setSavingResults] = useState(false);
  const [resultsWarnings, setResultsWarnings] = useState<string[]>([]);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [tournError, setTournError] = useState<string | null>(null);

  // Forums state
  type PendingForum = { id: string; title: string; description: string | null; game_type: string | null; creator_username: string; created_at: string };
  const [pendingForums, setPendingForums] = useState<PendingForum[]>([]);
  const [forumsLoading, setForumsLoading] = useState(false);
  const [forumsError, setForumsError] = useState<string | null>(null);
  const [forumsTab, setForumsTab] = useState<"pending" | "approved">("pending");
  const [actioningForum, setActioningForum] = useState<string | null>(null);

  // Scheduler state
  const [schedTeams, setSchedTeams] = useState<SchedulerTeam[]>([]);
  const [schedLoading, setSchedLoading] = useState(false);
  const [schedule, setSchedule] = useState<Record<string, string[]>>({ "6:00 PM": [], "7:15 PM": [], "8:30 PM": [] });
  const [weekLabel, setWeekLabel] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<SchedulerTeam | null>(null);

  useEffect(() => { if (user) checkAdminAndLoad(); }, [user]);
  useEffect(() => { if (isAdmin) loadReviews(reviewTab); }, [reviewTab, isAdmin]);
  useEffect(() => {
    if (!isAdmin) return;
    if (mainTab === "stats" && !statsData) loadStats();
    if (mainTab === "health" && !healthData) loadHealth();
    if (mainTab === "teams") loadAdminTeams();
    if (mainTab === "scheduler" && schedTeams.length === 0) loadSchedulerTeams();
    if (mainTab === "users") loadUsers();
    if (mainTab === "forums") loadPendingForums(forumsTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (mainTab === "tournaments") {
      if (tournTab === "manage") loadManageTournaments();
      else loadTournRequests(tournTab as "pending" | "approved" | "denied");
    }
  }, [mainTab, isAdmin]);
  useEffect(() => {
    if (!isAdmin || mainTab !== "tournaments") return;
    if (tournTab === "manage") loadManageTournaments();
    else loadTournRequests(tournTab as "pending" | "approved" | "denied");
  }, [tournTab]);

  async function checkAdminAndLoad() {
    const { data } = await supabase.from("profiles").select("role").eq("id", user!.id).single();
    const role = data?.role ?? "user";
    if (!["admin", "owner", "architect"].includes(role)) { router.replace("/"); return; }
    setIsAdmin(true);
    setUserRole(role);
    setChecking(false);
  }

  async function loadUsers() {
    setUsersLoading(true);
    setUsersError(null);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, role")
      .order("username", { ascending: true })
      .limit(200);
    if (error) { setUsersError(error.message); setUsersLoading(false); return; }
    setUsersData((data ?? []) as any[]);
    setUsersLoading(false);
  }

  async function handleRoleChange(targetId: string, newRole: string) {
    setRoleChanging(targetId);
    setUsersError(null);
    const { error } = await supabase.rpc("set_user_role", { target_user_id: targetId, new_role: newRole });
    if (error) { setUsersError(error.message); }
    else { setUsersData((prev) => prev.map((u) => u.id === targetId ? { ...u, role: newRole } : u)); }
    setRoleChanging(null);
  }

  // ── Reviews ────────────────────────────────────────────────────────────────

  async function loadReviews(tab: ReviewTab) {
    setReviewLoading(true);
    const { data } = await supabase
      .from("scores")
      .select("id, user_id, score, photo_url, created_at, profiles(username, avatar_url), games(name)")
      .eq("status", tab)
      .order("created_at", { ascending: tab === "pending" });

    setScores((data ?? []).map((row: any) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const game    = Array.isArray(row.games)    ? row.games[0]    : row.games;
      return {
        id: row.id, user_id: row.user_id,
        username:   profile?.username   ?? "Unknown",
        avatar_url: profile?.avatar_url ?? null,
        game_name:  game?.name          ?? "Unknown Game",
        score: row.score,
        photo_url:  row.photo_url       ?? null,
        created_at: row.created_at,
      };
    }));
    setReviewLoading(false);
    setReviewRefreshing(false);
  }

  async function handleDirectApprove(score: ReviewScore) {
    setReviewError(null);
    setActioning(score.id);
    const { data, error } = await supabase.rpc("rpc_admin_review_score", {
      p_score_id: score.id, p_status: "approved",
    });
    if (error) { setReviewError(error.message); }
    else if ((data as any)?.error) { setReviewError((data as any).message ?? (data as any).error); }
    else { setScores((prev) => prev.filter((s) => s.id !== score.id)); }
    setActioning(null);
  }

  function requestConfirm(score: ReviewScore, action: "deny" | "revoke" | "reapprove") {
    const map = {
      deny:      { toStatus: "denied"    as const, title: "Deny this score?",      body: `Deny ${score.username}'s ${score.score.toLocaleString()} pts on ${score.game_name}?`,                                              btnLabel: "Deny",    btnColor: "#ef4444", btnTextColor: "#fff" },
      revoke:    { toStatus: "denied"    as const, title: "Revoke approval?",       body: `Remove ${score.username}'s ${score.score.toLocaleString()} pts (${score.game_name}) from the leaderboard?`,                       btnLabel: "Revoke",  btnColor: "#ef4444", btnTextColor: "#fff" },
      reapprove: { toStatus: "approved"  as const, title: "Re-approve this score?", body: `Restore ${score.username}'s ${score.score.toLocaleString()} pts on ${score.game_name} to the leaderboard?`, btnLabel: "Approve", btnColor: "#22c55e", btnTextColor: "#000" },
    };
    setConfirmAction({ score, ...map[action] });
  }

  async function executeConfirm() {
    if (!confirmAction) return;
    setReviewError(null);
    setActioning(confirmAction.score.id);
    const { data, error } = await supabase.rpc("rpc_admin_review_score", {
      p_score_id: confirmAction.score.id, p_status: confirmAction.toStatus,
    });
    if (error) { setReviewError(error.message); }
    else if ((data as any)?.error) { setReviewError((data as any).message ?? (data as any).error); }
    else { setScores((prev) => prev.filter((s) => s.id !== confirmAction.score.id)); }
    setActioning(null);
    setConfirmAction(null);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  async function loadStats() {
    setStatsLoading(true);
    const todayISO = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); })();

    const [pendingRes, approvedRes, deniedRes, todayRes, scoresRes] = await Promise.all([
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("status", "approved"),
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("status", "denied"),
      supabase.from("scores").select("id", { count: "exact", head: true }).gte("created_at", todayISO),
      supabase.from("scores").select("user_id, score, games(type)").eq("status", "approved").limit(1000),
    ]);

    // Game breakdown
    const typeCounts: Record<string, number> = {};
    (scoresRes.data ?? []).forEach((s: any) => {
      const g = Array.isArray(s.games) ? s.games[0] : s.games;
      const t = g?.type ?? "other";
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    });
    const total = Object.values(typeCounts).reduce((a, b) => a + b, 0) || 1;
    const gameBreakdown = Object.entries(typeCounts)
      .map(([type, count]) => ({ type, label: TYPE_LABELS[type] ?? type, count }))
      .sort((a, b) => b.count - a.count);

    // Top players
    const playerMap: Record<string, { count: number; best: number }> = {};
    (scoresRes.data ?? []).forEach((s: any) => {
      if (!playerMap[s.user_id]) playerMap[s.user_id] = { count: 0, best: 0 };
      playerMap[s.user_id].count++;
      if (s.score > playerMap[s.user_id].best) playerMap[s.user_id].best = s.score;
    });
    const topIds = Object.entries(playerMap).sort((a, b) => b[1].count - a[1].count).slice(0, 5).map(([id]) => id);
    let topPlayers: StatsData["topPlayers"] = [];
    if (topIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, username, avatar_url").in("id", topIds);
      topPlayers = topIds.map(id => {
        const p = profiles?.find((x: any) => x.id === id);
        return { username: p?.username ?? "Unknown", avatar_url: p?.avatar_url ?? null, game_count: playerMap[id].count, best_score: playerMap[id].best };
      });
    }

    setStatsData({ pending: pendingRes.count ?? 0, approved: approvedRes.count ?? 0, denied: deniedRes.count ?? 0, today: todayRes.count ?? 0, gameBreakdown, topPlayers });
    setStatsLoading(false);
  }

  // ── Health ─────────────────────────────────────────────────────────────────

  async function loadHealth() {
    setHealthLoading(true);
    const weekISO  = new Date(Date.now() - 7 * 86400000).toISOString();
    const todayISO = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); })();

    const [totalUsersRes, newUsersRes, scoresWeekRes, scoresTodayRes, pendingRes, approvedRes, deniedRes] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", weekISO),
      supabase.from("scores").select("user_id").gte("created_at", weekISO),
      supabase.from("scores").select("id", { count: "exact", head: true }).gte("created_at", todayISO),
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("status", "approved"),
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("status", "denied"),
    ]);

    const activePlayersWeek = [...new Set((scoresWeekRes.data ?? []).map((s: any) => s.user_id))].length;
    const reviewed = (approvedRes.count ?? 0) + (deniedRes.count ?? 0);
    const approvalRate = reviewed > 0 ? Math.round(((approvedRes.count ?? 0) / reviewed) * 100) : 0;

    setHealthData({
      totalUsers: totalUsersRes.count ?? 0,
      newUsersWeek: newUsersRes.count ?? 0,
      activePlayersWeek,
      scoresToday: scoresTodayRes.count ?? 0,
      pendingQueue: pendingRes.count ?? 0,
      approvalRate,
    });
    setHealthLoading(false);
  }

  // ── Teams ──────────────────────────────────────────────────────────────────

  async function loadAdminTeams() {
    setTeamsLoading(true);
    const [teamsRes, membersRes] = await Promise.all([
      supabase.from("teams").select("id, name, captain_user_id, created_at").order("created_at", { ascending: false }),
      supabase.from("team_members").select("team_id"),
    ]);

    const captainIds = [...new Set((teamsRes.data ?? []).map((t: any) => t.captain_user_id))];
    let captainMap: Record<string, string> = {};
    if (captainIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id, username").in("id", captainIds);
      for (const p of profiles ?? []) captainMap[(p as any).id] = (p as any).username;
    }

    const memberCountMap: Record<string, number> = {};
    for (const m of membersRes.data ?? []) memberCountMap[(m as any).team_id] = (memberCountMap[(m as any).team_id] ?? 0) + 1;

    setAdminTeams((teamsRes.data ?? []).map((t: any) => ({
      id: t.id, name: t.name,
      captain_username: captainMap[t.captain_user_id] ?? "Unknown",
      member_count: memberCountMap[t.id] ?? 0,
      created_at: t.created_at,
    })));
    setTeamsLoading(false);
  }

  async function handleDeleteTeam() {
    if (!deleteTeamTarget) return;
    setTeamsError(null);
    setDeletingTeam(true);
    const { data, error } = await supabase.rpc("rpc_admin_delete_team", { p_team_id: deleteTeamTarget.id });
    if (error) { setTeamsError(error.message); }
    else if ((data as any)?.error) { setTeamsError((data as any).message ?? (data as any).error); }
    else { setAdminTeams((prev) => prev.filter((t) => t.id !== deleteTeamTarget.id)); }
    setDeletingTeam(false);
    setDeleteTeamTarget(null);
  }

  // ── Forums ─────────────────────────────────────────────────────────────────

  async function loadPendingForums(status: "pending" | "approved") {
    setForumsLoading(true);
    setForumsError(null);
    const { data, error } = await supabase
      .from("forums")
      .select("id, title, description, game_type, creator_id, created_at")
      .eq("status", status)
      .order("created_at", { ascending: status === "pending" });

    if (error) { setForumsError(error.message); setForumsLoading(false); return; }

    const creatorIds = [...new Set((data ?? []).map((f: any) => f.creator_id).filter(Boolean))] as string[];
    let usernameMap: Record<string, string> = {};
    if (creatorIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, username").in("id", creatorIds);
      for (const p of profiles ?? []) usernameMap[(p as any).id] = (p as any).username;
    }

    setPendingForums((data ?? []).map((f: any) => ({
      id: f.id, title: f.title, description: f.description,
      game_type: f.game_type,
      creator_username: f.creator_id ? (usernameMap[f.creator_id] ?? "Unknown") : "Unknown",
      created_at: f.created_at,
    })));
    setForumsLoading(false);
  }

  async function handleForumAction(forumId: string, newStatus: "approved" | "rejected") {
    setForumsError(null);
    setActioningForum(forumId);
    const { error } = await supabase.from("forums").update({ status: newStatus }).eq("id", forumId);
    if (error) { setForumsError(error.message); }
    else { setPendingForums((prev) => prev.filter((f) => f.id !== forumId)); }
    setActioningForum(null);
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────

  async function loadSchedulerTeams() {
    setSchedLoading(true);

    // Try with slot_pref columns; fall back to base columns if migration hasn't been run yet
    let teamsRes = await supabase.from("teams").select("id, name, slot_pref_1, slot_pref_2");
    if (teamsRes.error) {
      teamsRes = await supabase.from("teams").select("id, name") as typeof teamsRes;
    }

    const membersRes = await supabase.from("team_members").select("team_id, user_id");

    const teams = (teamsRes.data ?? []) as any[];
    const members = (membersRes.data ?? []) as any[];

    const teamUserIds: Record<string, string[]> = {};
    for (const m of members) (teamUserIds[m.team_id] ??= []).push(m.user_id);

    const allUserIds = [...new Set(members.map((m) => m.user_id as string))];
    let userAvgMap: Record<string, number> = {};
    if (allUserIds.length) {
      const { data: scoreData } = await supabase
        .from("scores").select("user_id, score").in("user_id", allUserIds).eq("status", "approved");
      const userBuckets: Record<string, number[]> = {};
      for (const s of scoreData ?? []) (userBuckets[(s as any).user_id] ??= []).push((s as any).score);
      for (const [uid, vals] of Object.entries(userBuckets))
        userAvgMap[uid] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }

    setSchedTeams(teams.map((t) => {
      const uids = teamUserIds[t.id] ?? [];
      const avgs = uids.map((uid) => userAvgMap[uid]).filter(Boolean) as number[];
      return {
        id: t.id, name: t.name,
        slot_pref_1: t.slot_pref_1, slot_pref_2: t.slot_pref_2,
        avg_score: avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : 0,
      };
    }));
    setSchedLoading(false);
  }

  function runAutoSchedule() {
    const sorted = [...schedTeams].sort((a, b) => b.avg_score - a.avg_score);
    // Snake-draft interleave so each slot gets a mix of skill levels
    const interleaved: SchedulerTeam[] = [];
    let lo = 0, hi = sorted.length - 1;
    while (lo <= hi) {
      interleaved.push(sorted[lo++]);
      if (lo <= hi) interleaved.push(sorted[hi--]);
    }

    const result: Record<string, string[]> = { "6:00 PM": [], "7:15 PM": [], "8:30 PM": [] };
    const unassigned: SchedulerTeam[] = [];

    for (const team of interleaved) {
      if (team.slot_pref_1 && result[team.slot_pref_1].length < MAX_TEAMS_PER_SLOT)
        result[team.slot_pref_1].push(team.id);
      else unassigned.push(team);
    }

    const stillUnassigned: SchedulerTeam[] = [];
    for (const team of unassigned) {
      if (team.slot_pref_2 && result[team.slot_pref_2].length < MAX_TEAMS_PER_SLOT)
        result[team.slot_pref_2].push(team.id);
      else stillUnassigned.push(team);
    }

    for (const team of stillUnassigned) {
      const slot = [...SCHED_SLOTS].sort((a, b) => result[a].length - result[b].length)[0];
      if (result[slot].length < MAX_TEAMS_PER_SLOT) result[slot].push(team.id);
    }

    setSchedule(result);
  }

  function moveTeamToSlot(teamId: string, newSlot: string) {
    setSchedule((prev) => {
      const next = { ...prev };
      for (const slot of SCHED_SLOTS) next[slot] = next[slot].filter((id) => id !== teamId);
      if (next[newSlot].length < MAX_TEAMS_PER_SLOT) next[newSlot] = [...next[newSlot], teamId];
      return next;
    });
    setReassignTarget(null);
  }

  async function saveSchedule() {
    setSavingSchedule(true);
    const label = weekLabel.trim() || new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
    await supabase.from("team_schedule").delete().eq("week_label", label);
    const inserts = Object.entries(schedule).flatMap(([slot, ids]) =>
      ids.map((tid) => ({ team_id: tid, slot_time: slot, week_label: label }))
    );
    if (inserts.length) await supabase.from("team_schedule").insert(inserts);
    setSavingSchedule(false);
  }

  // ── Tournaments ────────────────────────────────────────────────────────────

  async function loadTournRequests(status: "pending" | "approved" | "denied") {
    setTournLoading(true);
    const { data } = await supabase
      .from("tournament_requests")
      .select("id, user_id, title, description, game_type, proposed_date, max_teams, status, created_at")
      .eq("status", status)
      .order("created_at", { ascending: status === "pending" });

    const userIds = [...new Set((data ?? []).map((r: any) => r.user_id))] as string[];
    let usernameMap: Record<string, string> = {};
    if (userIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, username").in("id", userIds);
      for (const p of (profiles ?? [])) usernameMap[(p as any).id] = (p as any).username;
    }

    setTournRequests((data ?? []).map((r: any) => ({
      id: r.id, user_id: r.user_id,
      username: usernameMap[r.user_id] ?? "Unknown",
      title: r.title, description: r.description,
      game_type: r.game_type, proposed_date: r.proposed_date,
      max_teams: r.max_teams ?? 8, status: r.status, created_at: r.created_at,
    })));
    setTournLoading(false);
  }

  async function handleApproveTournament(req: TournamentRequest) {
    setTournError(null);
    setActioningTourn(req.id);
    const { data, error } = await supabase.rpc("rpc_admin_approve_tournament", { p_request_id: req.id });
    if (error) { setTournError(error.message); }
    else if ((data as any)?.error) { setTournError((data as any).message ?? (data as any).error); }
    else { setTournRequests((prev) => prev.filter((r) => r.id !== req.id)); }
    setActioningTourn(null);
  }

  async function handleDenyTournament() {
    if (!denyNoteTarget) return;
    setTournError(null);
    setActioningTourn(denyNoteTarget.id);
    const { data, error } = await supabase.rpc("rpc_admin_deny_tournament", {
      p_request_id: denyNoteTarget.id,
      p_note: denyNote.trim() || null,
    });
    if (error) { setTournError(error.message); }
    else if ((data as any)?.error) { setTournError((data as any).message ?? (data as any).error); }
    else { setTournRequests((prev) => prev.filter((r) => r.id !== denyNoteTarget.id)); }
    setActioningTourn(null);
    setDenyNoteTarget(null);
    setDenyNote("");
  }

  // ── Tournament management ──────────────────────────────────────────────────

  async function loadManageTournaments() {
    setManageLoading(true);
    const { data } = await supabase
      .from("tournaments")
      .select("id, title, game_type, status, proposed_date, is_official, created_at")
      .order("created_at", { ascending: false });
    setManageTournaments(data ?? []);
    setManageLoading(false);
  }

  async function handleMarkStatus(id: string, newStatus: string) {
    setTournError(null);
    setStatusActioning(id);
    const { data, error } = await supabase.rpc("rpc_admin_set_tournament_status", {
      p_tournament_id: id, p_status: newStatus,
    });
    if (error) { setTournError(error.message); }
    else if ((data as any)?.error) { setTournError((data as any).message ?? (data as any).error); }
    else { setManageTournaments((prev) => prev.map((t) => t.id === id ? { ...t, status: newStatus } : t)); }
    setStatusActioning(null);
  }

  function getNextFirstFriday(): Date {
    const now = new Date();
    const ff = (y: number, m: number) => {
      const d = new Date(y, m, 1);
      return new Date(y, m, 1 + ((5 - d.getDay() + 7) % 7));
    };
    const thisMonth = ff(now.getFullYear(), now.getMonth());
    return thisMonth > now ? thisMonth : ff(now.getFullYear(), now.getMonth() + 1);
  }

  async function handleCreateFirstFriday() {
    setTournError(null);
    setFirstFridayCreating(true);
    const date = getNextFirstFriday();
    const label = date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const { data, error } = await supabase.rpc("rpc_admin_create_first_friday", {
      p_date: date.toISOString(), p_label: label,
    });
    setFirstFridayCreating(false);
    if (error) { setTournError(error.message); return; }
    if ((data as any)?.error) { setTournError((data as any).message ?? (data as any).error); return; }
    await loadManageTournaments();
  }

  async function handleSaveResults() {
    if (!resultsTarget) return;
    setResultsWarnings([]);
    setSavingResults(true);
    const placements = resultEntries
      .filter((e) => e.username.trim())
      .map((e) => ({ place: e.place, username: e.username.trim() }));
    const { data, error } = await supabase.rpc("rpc_admin_save_placements", {
      p_tournament_id: resultsTarget.id,
      p_placements: placements,
    });
    setSavingResults(false);
    if (error) { setResultsWarnings([error.message]); return; }
    const result = data as { ok?: boolean; error?: string; message?: string; warnings?: string[] };
    if (result.error) { setResultsWarnings([result.message ?? result.error ?? "Unknown error"]); return; }
    setManageTournaments((prev) => prev.map((t) => t.id === resultsTarget.id ? { ...t, status: "completed" } : t));
    if (result.warnings?.length) {
      setResultsWarnings(result.warnings);
    } else {
      setResultsTarget(null);
      setResultEntries([{ place: 1, username: "" }, { place: 2, username: "" }, { place: 3, username: "" }]);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (authLoading || checking) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }
  if (!isAdmin) return null;

  return (
    <View style={styles.rootView}>
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/profile" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Admin Panel</Text>
          <Text style={styles.headerSub}>
            {mainTab === "reviews" ? "Score review queue"
              : mainTab === "stats" ? "Submission metrics"
              : mainTab === "teams" ? "Manage all teams"
              : mainTab === "scheduler" ? "Assign teams to time slots"
              : mainTab === "tournaments" ? "Tournament requests"
              : mainTab === "forums" ? "Forum approvals"
              : "Business health"}
          </Text>
        </View>
        {mainTab === "reviews" && reviewTab === "pending" && scores.length > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{scores.length}</Text>
          </View>
        )}
      </View>

      {/* Main tab bar */}
      <View style={styles.mainTabBar}>
        {MAIN_TABS.filter((t) => t.key !== "users" || userRole === "owner" || userRole === "architect").map(({ key, label, icon }) => (
          <Pressable
            key={key}
            style={[styles.mainTabItem, mainTab === key && styles.mainTabItemActive]}
            onPress={() => setMainTab(key)}
          >
            <Ionicons name={icon as any} size={16} color={mainTab === key ? "#f59e0b" : "#444"} />
            <Text style={[styles.mainTabLabel, mainTab === key && styles.mainTabLabelActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── Reviews ── */}
      {mainTab === "reviews" && (
        <>
          <View style={styles.subTabBar}>
            {REVIEW_TABS.map((tab) => (
              <Pressable
                key={tab}
                style={[styles.subTabItem, reviewTab === tab && styles.subTabItemActive]}
                onPress={() => { setReviewError(null); setReviewTab(tab); }}
              >
                <Text style={[styles.subTabLabel, reviewTab === tab && styles.subTabLabelActive]}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={reviewRefreshing} onRefresh={() => { setReviewRefreshing(true); loadReviews(reviewTab); }} tintColor="#06b6d4" />}
          >
            {reviewLoading ? (
              <ActivityIndicator color="#06b6d4" style={{ marginTop: 60 }} />
            ) : scores.length === 0 ? (
              <EmptyState {...REVIEW_EMPTY[reviewTab]} />
            ) : (
              <>
                {reviewError && <ErrorBanner message={reviewError} />}
                {scores.map((item) => (
                  <ScoreCard
                    key={item.id}
                    item={item}
                    tab={reviewTab}
                    actioning={actioning === item.id}
                    onApprove={() => handleDirectApprove(item)}
                    onDeny={() => requestConfirm(item, "deny")}
                    onRevoke={() => requestConfirm(item, "revoke")}
                    onReApprove={() => requestConfirm(item, "reapprove")}
                    onPhotoPress={() => item.photo_url && setPhotoModal(item.photo_url)}
                  />
                ))}
              </>
            )}
          </ScrollView>
        </>
      )}

      {/* ── Stats ── */}
      {mainTab === "stats" && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => { setStatsData(null); loadStats(); }} tintColor="#f59e0b" />}
        >
          {statsLoading || !statsData ? (
            <ActivityIndicator color="#f59e0b" style={{ marginTop: 60 }} />
          ) : (
            <StatsSection data={statsData} />
          )}
        </ScrollView>
      )}

      {/* ── Health ── */}
      {mainTab === "health" && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => { setHealthData(null); loadHealth(); }} tintColor="#f59e0b" />}
        >
          {healthLoading || !healthData ? (
            <ActivityIndicator color="#f59e0b" style={{ marginTop: 60 }} />
          ) : (
            <HealthSection data={healthData} />
          )}
        </ScrollView>
      )}

      {/* ── Teams ── */}
      {mainTab === "teams" && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={false} onRefresh={loadAdminTeams} tintColor="#06b6d4" />}
        >
          {teamsLoading ? (
            <ActivityIndicator color="#06b6d4" style={{ marginTop: 60 }} />
          ) : teamsError ? (
            <ErrorBanner message={teamsError} />
          ) : adminTeams.length === 0 ? (
            <EmptyState title="No teams yet" sub="Teams created by users will appear here." icon="people-outline" color="#06b6d4" />
          ) : (
            <>
              <View style={styles.teamsCountRow}>
                <Text style={styles.teamsCountText}>{adminTeams.length} {adminTeams.length === 1 ? "team" : "teams"}</Text>
              </View>
              {adminTeams.map((team) => (
                <View key={team.id} style={styles.adminTeamCard}>
                  <View style={styles.adminTeamAvatar}>
                    <Text style={styles.adminTeamAvatarText}>{team.name.slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.adminTeamName}>{team.name}</Text>
                    <Text style={styles.adminTeamMeta}>
                      Captain: {team.captain_username} · {team.member_count} {team.member_count === 1 ? "member" : "members"}
                    </Text>
                    <Text style={styles.adminTeamDate}>Created {relTime(team.created_at)}</Text>
                  </View>
                  <Pressable style={styles.deleteTeamBtn} onPress={() => setDeleteTeamTarget(team)}>
                    <Ionicons name="trash-outline" size={16} color="#ef4444" />
                  </Pressable>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* ── Scheduler ── */}
      {mainTab === "scheduler" && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {schedLoading ? (
            <ActivityIndicator color="#06b6d4" style={{ marginTop: 60 }} />
          ) : (
            <>
              {/* Week label + actions */}
              <View style={styles.schedHeader}>
                <TextInput
                  style={styles.schedWeekInput}
                  placeholder="Week label (e.g. Week 1, June 9…)"
                  placeholderTextColor="#333"
                  value={weekLabel}
                  onChangeText={setWeekLabel}
                />
                <View style={styles.schedBtnRow}>
                  <Pressable style={styles.schedAutoBtn} onPress={runAutoSchedule}>
                    <Ionicons name="flash" size={15} color="#000" />
                    <Text style={styles.schedAutoBtnText}>Auto-Schedule</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.schedSaveBtn, savingSchedule && { opacity: 0.5 }]}
                    onPress={saveSchedule}
                    disabled={savingSchedule}
                  >
                    {savingSchedule
                      ? <ActivityIndicator size="small" color="#000" />
                      : <><Ionicons name="save-outline" size={15} color="#000" /><Text style={styles.schedSaveBtnText}>Save</Text></>}
                  </Pressable>
                </View>
                {schedTeams.length === 0 && (
                  <Text style={styles.schedNoTeams}>No teams found. Teams need to be created first.</Text>
                )}
              </View>

              {/* Slot sections */}
              {SCHED_SLOTS.map((slot) => {
                const assignedIds = schedule[slot] ?? [];
                const assigned = assignedIds.map((id) => schedTeams.find((t) => t.id === id)).filter(Boolean) as SchedulerTeam[];
                return (
                  <View key={slot} style={styles.schedSlotSection}>
                    <View style={styles.schedSlotHeader}>
                      <Text style={styles.schedSlotTime}>{slot}</Text>
                      <View style={styles.schedSlotCount}>
                        <Text style={styles.schedSlotCountText}>{assigned.length}/{MAX_TEAMS_PER_SLOT}</Text>
                      </View>
                    </View>
                    {assigned.length === 0 ? (
                      <Text style={styles.schedEmptySlot}>No teams assigned</Text>
                    ) : (
                      assigned.map((team) => (
                        <Pressable
                          key={team.id}
                          style={styles.schedTeamCard}
                          onPress={() => setReassignTarget(team)}
                        >
                          <View style={styles.schedTeamLeft}>
                            <Text style={styles.schedTeamName}>{team.name}</Text>
                            <View style={styles.schedTeamPrefs}>
                              {team.slot_pref_1 && (
                                <View style={[styles.schedPrefChip, team.slot_pref_1 === slot && styles.schedPrefChipMatch]}>
                                  <Text style={[styles.schedPrefChipText, team.slot_pref_1 === slot && styles.schedPrefChipTextMatch]}>1st: {team.slot_pref_1}</Text>
                                </View>
                              )}
                              {team.slot_pref_2 && (
                                <View style={[styles.schedPrefChip, team.slot_pref_2 === slot && styles.schedPrefChip2Match]}>
                                  <Text style={[styles.schedPrefChipText, team.slot_pref_2 === slot && styles.schedPrefChip2MatchText]}>2nd: {team.slot_pref_2}</Text>
                                </View>
                              )}
                            </View>
                          </View>
                          <View style={styles.schedTeamRight}>
                            {team.avg_score > 0 && <Text style={styles.schedTeamAvg}>{team.avg_score} avg</Text>}
                            <Ionicons name="swap-horizontal-outline" size={16} color="#444" />
                          </View>
                        </Pressable>
                      ))
                    )}
                  </View>
                );
              })}

              {/* Unassigned teams */}
              {(() => {
                const assignedAll = new Set(Object.values(schedule).flat());
                const unassigned = schedTeams.filter((t) => !assignedAll.has(t.id));
                if (!unassigned.length) return null;
                return (
                  <View style={styles.schedSlotSection}>
                    <View style={styles.schedSlotHeader}>
                      <Text style={[styles.schedSlotTime, { color: "#ef4444" }]}>Unassigned</Text>
                      <View style={[styles.schedSlotCount, { backgroundColor: "rgba(239,68,68,0.15)", borderColor: "#ef4444" }]}>
                        <Text style={[styles.schedSlotCountText, { color: "#ef4444" }]}>{unassigned.length}</Text>
                      </View>
                    </View>
                    {unassigned.map((team) => (
                      <Pressable key={team.id} style={styles.schedTeamCard} onPress={() => setReassignTarget(team)}>
                        <Text style={styles.schedTeamName}>{team.name}</Text>
                        <Ionicons name="add-circle-outline" size={18} color="#06b6d4" />
                      </Pressable>
                    ))}
                  </View>
                );
              })()}
            </>
          )}
        </ScrollView>
      )}

      {/* Reassign modal */}
      <Modal visible={!!reassignTarget} transparent animationType="slide" onRequestClose={() => setReassignTarget(null)}>
        <Pressable style={styles.modalBg} onPress={() => setReassignTarget(null)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{reassignTarget?.name}</Text>
            <Text style={styles.modalSub}>Move to which time slot?</Text>
            {SCHED_SLOTS.map((slot) => {
              const count = (schedule[slot] ?? []).length;
              const full = count >= MAX_TEAMS_PER_SLOT && !schedule[slot].includes(reassignTarget?.id ?? "");
              return (
                <Pressable
                  key={slot}
                  style={[styles.schedReassignRow, full && { opacity: 0.4 }]}
                  onPress={() => !full && reassignTarget && moveTeamToSlot(reassignTarget.id, slot)}
                  disabled={full}
                >
                  <Text style={styles.schedReassignTime}>{slot}</Text>
                  <Text style={styles.schedReassignCount}>{count}/{MAX_TEAMS_PER_SLOT}</Text>
                  {schedule[slot]?.includes(reassignTarget?.id ?? "") && (
                    <Ionicons name="checkmark-circle" size={18} color="#06b6d4" />
                  )}
                </Pressable>
              );
            })}
            <Pressable style={styles.schedRemoveBtn} onPress={() => {
              if (!reassignTarget) return;
              setSchedule((prev) => {
                const next = { ...prev };
                for (const s of SCHED_SLOTS) next[s] = next[s].filter((id) => id !== reassignTarget.id);
                return next;
              });
              setReassignTarget(null);
            }}>
              <Text style={styles.schedRemoveBtnText}>Remove from schedule</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Tournaments ── */}
      {mainTab === "tournaments" && (
        <>
          <View style={styles.subTabBar}>
            {(["pending", "approved", "denied", "manage"] as const).map((tab) => (
              <Pressable
                key={tab}
                style={[styles.subTabItem, tournTab === tab && styles.subTabItemActive]}
                onPress={() => setTournTab(tab)}
              >
                <Text style={[styles.subTabLabel, tournTab === tab && styles.subTabLabelActive]}>
                  {tab === "manage" ? "Manage" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          {tournError && (
            <View style={[styles.inlineError, { margin: 12, marginBottom: 0 }]}>
              <Text style={styles.inlineErrorText}>{tournError}</Text>
            </View>
          )}

          {/* Manage tab */}
          {tournTab === "manage" && (
            <>
              <View style={styles.manageHeader}>
                <Text style={styles.manageHeaderTitle}>All Tournaments</Text>
                <Pressable
                  style={[styles.firstFridayBtn, firstFridayCreating && { opacity: 0.5 }]}
                  onPress={handleCreateFirstFriday}
                  disabled={firstFridayCreating}
                >
                  {firstFridayCreating
                    ? <ActivityIndicator size="small" color="#000" />
                    : <><Ionicons name="add" size={14} color="#000" /><Text style={styles.firstFridayBtnText}>First Friday</Text></>}
                </Pressable>
              </View>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={false} onRefresh={loadManageTournaments} tintColor="#f59e0b" />}
              >
                {manageLoading ? (
                  <ActivityIndicator color="#f59e0b" style={{ marginTop: 60 }} />
                ) : manageTournaments.length === 0 ? (
                  <EmptyState title="No tournaments" sub="Approved requests appear here." icon="trophy-outline" color="#f59e0b" />
                ) : (
                  manageTournaments.map((t) => {
                    const sc = MANAGE_STATUS_COLORS[t.status] ?? "#555";
                    const acting = statusActioning === t.id;
                    return (
                      <View key={t.id} style={styles.manageTournCard}>
                        <View style={{ flex: 1 }}>
                          <View style={styles.manageTournTopRow}>
                            <Text style={styles.manageTournTitle} numberOfLines={1}>{t.title}</Text>
                            <View style={[styles.manageTournStatus, { backgroundColor: sc + "18", borderColor: sc + "35" }]}>
                              <Text style={[styles.manageTournStatusText, { color: sc }]}>
                                {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                              </Text>
                            </View>
                          </View>
                          {t.proposed_date && (
                            <Text style={styles.manageTournDate}>
                              {new Date(t.proposed_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              {t.game_type ? ` · ${t.game_type}` : ""}
                            </Text>
                          )}
                        </View>
                        <View style={styles.manageTournActions}>
                          {t.status === "upcoming" && (
                            <Pressable style={[styles.manageTournBtn, acting && { opacity: 0.5 }]} onPress={() => handleMarkStatus(t.id, "active")} disabled={acting}>
                              <Text style={styles.manageTournBtnText}>Activate</Text>
                            </Pressable>
                          )}
                          {(t.status === "upcoming" || t.status === "active") && (
                            <Pressable
                              style={[styles.manageTournResultsBtn, acting && { opacity: 0.5 }]}
                              onPress={() => {
                                setResultsWarnings([]);
                                setResultsTarget(t);
                                setResultEntries([{ place: 1, username: "" }, { place: 2, username: "" }, { place: 3, username: "" }]);
                              }}
                              disabled={acting}
                            >
                              <Ionicons name="trophy" size={13} color="#f59e0b" />
                              <Text style={styles.manageTournResultsText}>Results</Text>
                            </Pressable>
                          )}
                          {t.status === "completed" && (
                            <View style={styles.manageTournCompletedTag}>
                              <Text style={styles.manageTournCompletedText}>Done</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </>
          )}

          {/* Requests tabs (pending / approved / denied) */}
          {tournTab !== "manage" && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={false} onRefresh={() => loadTournRequests(tournTab as "pending" | "approved" | "denied")} tintColor="#f59e0b" />}
          >
            {tournLoading ? (
              <ActivityIndicator color="#f59e0b" style={{ marginTop: 60 }} />
            ) : tournRequests.length === 0 ? (
              <EmptyState
                title={tournTab === "pending" ? "No pending requests" : tournTab === "approved" ? "No approved requests" : "No denied requests"}
                sub={tournTab === "pending" ? "Community tournament requests will appear here." : "Handled requests appear here."}
                icon="trophy-outline"
                color="#f59e0b"
              />
            ) : (
              <>
                <View style={styles.teamsCountRow}>
                  <Text style={styles.teamsCountText}>{tournRequests.length} {tournRequests.length === 1 ? "request" : "requests"}</Text>
                </View>
                {tournRequests.map((req) => (
                  <View key={req.id} style={styles.tournCard}>
                    <View style={styles.tournCardTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.tournTitle}>{req.title}</Text>
                        <Text style={styles.tournMeta}>
                          By {req.username} · {relTime(req.created_at)}
                        </Text>
                      </View>
                      {req.game_type && (
                        <View style={styles.tournGameChip}>
                          <Text style={styles.tournGameChipText}>{req.game_type}</Text>
                        </View>
                      )}
                    </View>
                    {req.description ? (
                      <Text style={styles.tournDesc}>{req.description}</Text>
                    ) : null}
                    <View style={styles.tournMeta2Row}>
                      {req.proposed_date && (
                        <View style={styles.tournMetaChip}>
                          <Ionicons name="calendar-outline" size={12} color="#888" />
                          <Text style={styles.tournMetaChipText}>
                            {new Date(req.proposed_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </Text>
                        </View>
                      )}
                      <View style={styles.tournMetaChip}>
                        <Ionicons name="people-outline" size={12} color="#888" />
                        <Text style={styles.tournMetaChipText}>Max {req.max_teams} teams</Text>
                      </View>
                    </View>
                    {tournTab === "pending" && (
                      <View style={styles.tournActions}>
                        <Pressable
                          style={[styles.tournDenyBtn, actioning_tourn === req.id && { opacity: 0.5 }]}
                          onPress={() => { setDenyNoteTarget(req); setDenyNote(""); }}
                          disabled={actioning_tourn === req.id}
                        >
                          <Ionicons name="close" size={16} color="#ef4444" />
                          <Text style={styles.tournDenyBtnText}>Deny</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.tournApproveBtn, actioning_tourn === req.id && { opacity: 0.5 }]}
                          onPress={() => handleApproveTournament(req)}
                          disabled={actioning_tourn === req.id}
                        >
                          {actioning_tourn === req.id
                            ? <ActivityIndicator size="small" color="#000" />
                            : <><Ionicons name="checkmark" size={16} color="#000" /><Text style={styles.tournApproveBtnText}>Approve</Text></>}
                        </Pressable>
                      </View>
                    )}
                  </View>
                ))}
              </>
            )}
          </ScrollView>
          )}
        </>
      )}

      {/* ── Users ── */}
      {mainTab === "users" && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={false} onRefresh={loadUsers} tintColor="#06b6d4" />}
        >
          {usersError && <ErrorBanner message={usersError} />}
          <TextInput
            style={styles.userSearchInput}
            placeholder="Search by username…"
            placeholderTextColor="#444"
            value={userSearch}
            onChangeText={setUserSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {usersLoading ? (
            <ActivityIndicator color="#06b6d4" style={{ marginTop: 60 }} />
          ) : (
            usersData
              .filter((u) => !userSearch || u.username?.toLowerCase().includes(userSearch.toLowerCase()))
              .map((u) => {
                const cfg: Record<string, { color: string }> = {
                  architect: { color: "#a855f7" },
                  owner:     { color: "#f59e0b" },
                  admin:     { color: "#3b82f6" },
                  user:      { color: "#444" },
                };
                const color = cfg[u.role]?.color ?? "#444";
                const availableRoles = userRole === "architect"
                  ? ["user", "admin", "owner", "architect"]
                  : ["user", "admin"];
                return (
                  <View key={u.id} style={styles.userCard}>
                    <Avatar uri={u.avatar_url} name={u.username} size={42} radius={13} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.userCardName}>{u.username ?? "Unknown"}</Text>
                      <View style={[styles.userRolePill, { borderColor: color + "44", backgroundColor: color + "12" }]}>
                        {u.role !== "user" && <Ionicons name="checkmark-circle" size={11} color={color} />}
                        <Text style={[styles.userRolePillText, { color }]}>{u.role}</Text>
                      </View>
                    </View>
                    <View style={styles.userRoleActions}>
                      {availableRoles
                        .filter((r) => r !== u.role)
                        .map((r) => (
                          <Pressable
                            key={r}
                            style={[styles.userRoleBtn, roleChanging === u.id && { opacity: 0.4 }]}
                            onPress={() => handleRoleChange(u.id, r)}
                            disabled={roleChanging === u.id}
                          >
                            <Text style={styles.userRoleBtnText}>→ {r}</Text>
                          </Pressable>
                        ))}
                    </View>
                  </View>
                );
              })
          )}
        </ScrollView>
      )}

      {/* ── Forums ── */}
      {mainTab === "forums" && (
        <>
          <View style={styles.subTabBar}>
            {(["pending", "approved"] as const).map((tab) => (
              <Pressable
                key={tab}
                style={[styles.subTabItem, forumsTab === tab && styles.subTabItemActive]}
                onPress={() => { setForumsTab(tab); loadPendingForums(tab); }}
              >
                <Text style={[styles.subTabLabel, forumsTab === tab && styles.subTabLabelActive]}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
          {forumsError && (
            <View style={[styles.inlineError, { margin: 12 }]}>
              <Text style={styles.inlineErrorText}>{forumsError}</Text>
            </View>
          )}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={false} onRefresh={() => loadPendingForums(forumsTab)} tintColor="#06b6d4" />}
          >
            {forumsLoading ? (
              <ActivityIndicator color="#06b6d4" style={{ marginTop: 60 }} />
            ) : pendingForums.length === 0 ? (
              <EmptyState
                title={forumsTab === "pending" ? "No pending forums" : "No approved forums"}
                sub={forumsTab === "pending" ? "User forum requests will appear here." : "Approved forums appear here."}
                icon="chatbubbles-outline"
                color="#06b6d4"
              />
            ) : (
              <>
                <View style={styles.teamsCountRow}>
                  <Text style={styles.teamsCountText}>{pendingForums.length} {pendingForums.length === 1 ? "forum" : "forums"}</Text>
                </View>
                {pendingForums.map((forum) => (
                  <View key={forum.id} style={styles.tournCard}>
                    <View style={styles.tournCardTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.tournTitle}>{forum.title}</Text>
                        <Text style={styles.tournMeta}>By {forum.creator_username} · {relTime(forum.created_at)}</Text>
                      </View>
                      {forum.game_type && (
                        <View style={styles.tournGameChip}>
                          <Text style={styles.tournGameChipText}>{forum.game_type}</Text>
                        </View>
                      )}
                    </View>
                    {forum.description ? <Text style={styles.tournDesc}>{forum.description}</Text> : null}
                    {forumsTab === "pending" && (
                      <View style={styles.tournActions}>
                        <Pressable
                          style={[styles.tournDenyBtn, actioningForum === forum.id && { opacity: 0.5 }]}
                          onPress={() => handleForumAction(forum.id, "rejected")}
                          disabled={actioningForum === forum.id}
                        >
                          <Ionicons name="close" size={16} color="#ef4444" />
                          <Text style={styles.tournDenyBtnText}>Reject</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.tournApproveBtn, actioningForum === forum.id && { opacity: 0.5 }]}
                          onPress={() => handleForumAction(forum.id, "approved")}
                          disabled={actioningForum === forum.id}
                        >
                          {actioningForum === forum.id
                            ? <ActivityIndicator size="small" color="#000" />
                            : <><Ionicons name="checkmark" size={16} color="#000" /><Text style={styles.tournApproveBtnText}>Approve</Text></>}
                        </Pressable>
                      </View>
                    )}
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </>
      )}

      {/* Post results modal */}
      <Modal visible={!!resultsTarget} transparent animationType="slide" onRequestClose={() => setResultsTarget(null)}>
        <View style={styles.modalBg}>
          <Pressable style={styles.modalDismiss} onPress={() => setResultsTarget(null)} />
          <View style={styles.resultsSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.resultsTitle}>Post Results</Text>
            <Text style={styles.resultsSub} numberOfLines={1}>{resultsTarget?.title}</Text>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {resultEntries.map((entry, i) => (
                <View key={i} style={styles.resultRow}>
                  <Text style={styles.resultPlaceLabel}>{PLACEMENT_LABELS[i] ?? `#${i + 1}`}</Text>
                  <TextInput
                    style={styles.resultInput}
                    placeholder="username"
                    placeholderTextColor="#333"
                    value={entry.username}
                    onChangeText={(v) => setResultEntries((prev) => prev.map((e, j) => j === i ? { ...e, username: v } : e))}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              ))}
              <Pressable
                style={styles.addPlaceBtn}
                onPress={() => setResultEntries((prev) => [...prev, { place: prev.length + 1, username: "" }])}
              >
                <Ionicons name="add" size={14} color="#06b6d4" />
                <Text style={styles.addPlaceBtnText}>Add another place</Text>
              </Pressable>
              {resultsWarnings.length > 0 && (
                <View style={[styles.inlineError, { marginBottom: 12 }]}>
                  {resultsWarnings.map((w, i) => (
                    <Text key={i} style={styles.inlineErrorText}>{w}</Text>
                  ))}
                </View>
              )}
              <View style={styles.resultsBtns}>
                <Pressable style={styles.confirmCancel} onPress={() => { setResultsTarget(null); setResultsWarnings([]); }}>
                  <Text style={styles.confirmCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.resultsSubmitBtn, savingResults && { opacity: 0.5 }]}
                  onPress={handleSaveResults}
                  disabled={savingResults}
                >
                  {savingResults
                    ? <ActivityIndicator size="small" color="#000" />
                    : <Text style={styles.resultsSubmitText}>Save & Complete</Text>}
                </Pressable>
              </View>
              <View style={{ height: 16 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Deny tournament modal */}
      <Modal visible={!!denyNoteTarget} transparent animationType="fade" onRequestClose={() => setDenyNoteTarget(null)}>
        <View style={styles.confirmBg}>
          <Pressable style={styles.confirmDismiss} onPress={() => setDenyNoteTarget(null)} />
          <View style={styles.confirmSheet}>
            <View style={[styles.confirmIconWrap, { backgroundColor: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.25)" }]}>
              <Ionicons name="close-circle-outline" size={36} color="#ef4444" />
            </View>
            <Text style={styles.confirmTitle}>Deny Request?</Text>
            <Text style={styles.confirmBody}>"{denyNoteTarget?.title}"</Text>
            <TextInput
              style={[styles.confirmInput, { marginBottom: 20 }]}
              placeholder="Optional note to requester..."
              placeholderTextColor="#333"
              value={denyNote}
              onChangeText={setDenyNote}
              maxLength={200}
              multiline
            />
            <View style={styles.confirmBtns}>
              <Pressable style={styles.confirmCancel} onPress={() => setDenyNoteTarget(null)}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmActionBtn, { backgroundColor: "#ef4444" }, !!actioning_tourn && { opacity: 0.5 }]}
                onPress={handleDenyTournament}
                disabled={!!actioning_tourn}
              >
                {actioning_tourn
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={[styles.confirmActionText, { color: "#fff" }]}>Deny</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete team confirm modal */}
      <Modal visible={!!deleteTeamTarget} transparent animationType="fade" onRequestClose={() => setDeleteTeamTarget(null)}>
        <View style={styles.confirmBg}>
          <Pressable style={styles.confirmDismiss} onPress={() => setDeleteTeamTarget(null)} />
          <View style={styles.confirmSheet}>
            <View style={[styles.confirmIconWrap, { backgroundColor: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.25)" }]}>
              <Ionicons name="people" size={36} color="#ef4444" />
            </View>
            <Text style={styles.confirmTitle}>Delete "{deleteTeamTarget?.name}"?</Text>
            <Text style={styles.confirmBody}>
              This will permanently remove the team, all {deleteTeamTarget?.member_count} {deleteTeamTarget?.member_count === 1 ? "member" : "members"}, and all join requests. This cannot be undone.
            </Text>
            <View style={styles.confirmBtns}>
              <Pressable style={styles.confirmCancel} onPress={() => setDeleteTeamTarget(null)}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.confirmActionBtn, { backgroundColor: "#ef4444" }, deletingTeam && { opacity: 0.5 }]} onPress={handleDeleteTeam} disabled={deletingTeam}>
                {deletingTeam
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={[styles.confirmActionText, { color: "#fff" }]}>Delete Team</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Confirm modal */}
      <Modal visible={!!confirmAction} transparent animationType="fade" onRequestClose={() => setConfirmAction(null)}>
        <View style={styles.confirmBg}>
          <Pressable style={styles.confirmDismiss} onPress={() => setConfirmAction(null)} />
          <View style={styles.confirmSheet}>
            <View style={[styles.confirmIconWrap, { backgroundColor: (confirmAction?.btnColor ?? "#ef4444") + "15", borderColor: (confirmAction?.btnColor ?? "#ef4444") + "35" }]}>
              <Ionicons name={confirmAction?.toStatus === "approved" ? "checkmark-circle-outline" : "close-circle-outline"} size={40} color={confirmAction?.btnColor ?? "#ef4444"} />
            </View>
            <Text style={styles.confirmTitle}>{confirmAction?.title}</Text>
            <Text style={styles.confirmBody}>{confirmAction?.body}</Text>
            <View style={styles.confirmBtns}>
              <Pressable style={styles.confirmCancel} onPress={() => setConfirmAction(null)}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.confirmActionBtn, { backgroundColor: confirmAction?.btnColor ?? "#ef4444" }, !!actioning && { opacity: 0.5 }]} onPress={executeConfirm} disabled={!!actioning}>
                {actioning
                  ? <ActivityIndicator size="small" color={confirmAction?.btnTextColor ?? "#fff"} />
                  : <Text style={[styles.confirmActionText, { color: confirmAction?.btnTextColor ?? "#fff" }]}>{confirmAction?.btnLabel}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Photo modal */}
      <Modal visible={!!photoModal} transparent animationType="fade" onRequestClose={() => setPhotoModal(null)}>
        <Pressable style={styles.photoModalBg} onPress={() => setPhotoModal(null)}>
          <View style={styles.photoModalInner}>
            <View style={styles.photoModalHeader}>
              <Text style={styles.photoModalTitle}>Score Proof</Text>
              <Pressable onPress={() => setPhotoModal(null)}>
                <Ionicons name="close-circle" size={28} color="#555" />
              </Pressable>
            </View>
            {photoModal && <Image source={{ uri: photoModal }} style={styles.photoModalImage} contentFit="contain" cachePolicy="none" />}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
    <BottomTabBar />
    </View>
  );
}

// ─── Stats Section ─────────────────────────────────────────────────────────────

function StatsSection({ data }: { data: StatsData }) {
  const totalScores = data.pending + data.approved + data.denied || 1;

  return (
    <>
      {/* Score overview */}
      <SectionHeader title="Score Overview" />
      <View style={styles.statRow}>
        <StatCard label="Pending"  value={data.pending}  color="#f59e0b" />
        <StatCard label="Approved" value={data.approved} color="#22c55e" />
        <StatCard label="Denied"   value={data.denied}   color="#ef4444" />
      </View>
      <View style={[styles.card, { padding: 16, marginBottom: 20 }]}>
        <Text style={styles.cardLabel}>Submitted Today</Text>
        <Text style={styles.cardBigValue}>{data.today}</Text>
        <Text style={styles.cardSubLabel}>All-time total: {totalScores - 1}</Text>
      </View>

      {/* Game breakdown */}
      {data.gameBreakdown.length > 0 && (
        <>
          <SectionHeader title="By Game Type" />
          {data.gameBreakdown.map(({ type, label, count }) => {
            const pct = Math.round((count / (data.approved || 1)) * 100);
            const color = TYPE_COLORS[type] ?? "#555";
            return (
              <View key={type} style={[styles.card, { padding: 14, marginBottom: 8 }]}>
                <View style={styles.breakdownRow}>
                  <View style={[styles.breakdownDot, { backgroundColor: color }]} />
                  <Text style={styles.breakdownLabel}>{label}</Text>
                  <Text style={styles.breakdownCount}>{count}</Text>
                  <Text style={[styles.breakdownPct, { color }]}>{pct}%</Text>
                </View>
                <View style={styles.barBg}>
                  <View style={[styles.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
                </View>
              </View>
            );
          })}
        </>
      )}

      {/* Top players */}
      {data.topPlayers.length > 0 && (
        <>
          <SectionHeader title="Top Players" sub="by approved score count" />
          {data.topPlayers.map((p, i) => (
            <View key={p.username} style={[styles.card, styles.playerRow]}>
              <Text style={styles.playerRank}>#{i + 1}</Text>
              <Avatar uri={p.avatar_url} name={p.username} size={38} />
              <View style={{ flex: 1 }}>
                <Text style={styles.playerName}>{p.username}</Text>
                <Text style={styles.playerSub}>{p.game_count} games · best {p.best_score.toLocaleString()}</Text>
              </View>
              <Ionicons name="trophy" size={16} color={i === 0 ? "#f59e0b" : i === 1 ? "#94a3b8" : "#cd7c3e"} />
            </View>
          ))}
        </>
      )}
    </>
  );
}

// ─── Health Section ────────────────────────────────────────────────────────────

function HealthSection({ data }: { data: HealthData }) {
  return (
    <>
      <SectionHeader title="User Base" />
      <View style={styles.statRow}>
        <StatCard label="Total Users"   value={data.totalUsers}      color="#06b6d4" />
        <StatCard label="New (7 days)"  value={data.newUsersWeek}    color="#a855f7" />
      </View>
      <StatCard label="Active Players (last 7 days)" value={data.activePlayersWeek} color="#22c55e" wide />

      <SectionHeader title="Activity" />
      <View style={styles.statRow}>
        <StatCard label="Scores Today"   value={data.scoresToday}   color="#f59e0b" />
        <StatCard label="Pending Review" value={data.pendingQueue}  color={data.pendingQueue > 10 ? "#ef4444" : "#f59e0b"} />
      </View>

      <SectionHeader title="Review Quality" />
      <View style={[styles.card, { padding: 20, alignItems: "center", marginBottom: 8 }]}>
        <Text style={[styles.bigPct, { color: data.approvalRate >= 70 ? "#22c55e" : data.approvalRate >= 40 ? "#f59e0b" : "#ef4444" }]}>
          {data.approvalRate}%
        </Text>
        <Text style={styles.bigPctLabel}>Approval Rate</Text>
        <Text style={styles.bigPctSub}>of all reviewed scores have been approved</Text>
      </View>

      <View style={[styles.card, { padding: 16, marginBottom: 20 }]}>
        <View style={styles.healthHintRow}>
          <Ionicons name="information-circle-outline" size={16} color="#444" />
          <Text style={styles.healthHint}>Pull to refresh for latest data. Stats are based on approved scores only.</Text>
        </View>
      </View>
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {sub && <Text style={styles.sectionSub}>{sub}</Text>}
    </View>
  );
}

function StatCard({ label, value, color, wide }: { label: string; value: number; color: string; wide?: boolean }) {
  return (
    <View style={[styles.card, styles.statCard, wide && styles.statCardWide, { borderColor: color + "22" }]}>
      <Text style={[styles.statValue, { color }]}>{value.toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function EmptyState({ title, sub, icon, color }: { title: string; sub: string; icon: string; color: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: color + "10", borderColor: color + "30" }]}>
        <Ionicons name={icon as any} size={52} color={color} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{sub}</Text>
    </View>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.inlineError}>
      <Text style={styles.inlineErrorText}>{message}</Text>
    </View>
  );
}

function ScoreCard({ item, tab, actioning, onApprove, onDeny, onRevoke, onReApprove, onPhotoPress }: {
  item: ReviewScore; tab: ReviewTab; actioning: boolean;
  onApprove: () => void; onDeny: () => void; onRevoke: () => void; onReApprove: () => void; onPhotoPress: () => void;
}) {
  return (
    <View style={styles.card}>
      {tab !== "pending" && (
        <View style={[styles.statusBanner, { backgroundColor: tab === "approved" ? "rgba(34,197,94,0.07)" : "rgba(239,68,68,0.07)" }]}>
          <Ionicons name={tab === "approved" ? "checkmark-circle" : "close-circle"} size={12} color={tab === "approved" ? "#22c55e" : "#ef4444"} />
          <Text style={[styles.statusBannerText, { color: tab === "approved" ? "#22c55e" : "#ef4444" }]}>
            {tab === "approved" ? "Approved" : "Denied"}
          </Text>
        </View>
      )}
      <View style={styles.cardUser}>
        <Avatar uri={item.avatar_url} name={item.username} size={42} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardUsername}>{item.username}</Text>
          <Text style={styles.cardGame}>{item.game_name} · {relTime(item.created_at)}</Text>
        </View>
        <Text style={styles.cardScore}>{item.score.toLocaleString()}</Text>
      </View>

      {item.photo_url ? (
        <Pressable style={styles.photoWrap} onPress={onPhotoPress}>
          <Image source={{ uri: item.photo_url }} style={styles.photoThumb} contentFit="cover" cachePolicy="none" />
          <View style={styles.photoTapHint}>
            <Ionicons name="expand-outline" size={14} color="#fff" />
            <Text style={styles.photoTapText}>Tap to enlarge</Text>
          </View>
        </Pressable>
      ) : (
        <View style={styles.noPhoto}>
          <Ionicons name="image-outline" size={20} color="#333" />
          <Text style={styles.noPhotoText}>No photo attached</Text>
        </View>
      )}

      <View style={styles.cardActions}>
        {tab === "pending" && (
          <>
            <Pressable style={[styles.denyBtn, actioning && { opacity: 0.5 }]} onPress={onDeny} disabled={actioning}>
              {actioning ? <ActivityIndicator size="small" color="#ef4444" /> : <Ionicons name="close" size={18} color="#ef4444" />}
              <Text style={styles.denyBtnText}>Deny</Text>
            </Pressable>
            <Pressable style={[styles.approveBtn, actioning && { opacity: 0.5 }]} onPress={onApprove} disabled={actioning}>
              {actioning ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="checkmark" size={18} color="#000" />}
              <Text style={styles.approveBtnText}>Approve</Text>
            </Pressable>
          </>
        )}
        {tab === "approved" && (
          <Pressable style={[styles.revokeBtn, actioning && { opacity: 0.5 }]} onPress={onRevoke} disabled={actioning}>
            {actioning ? <ActivityIndicator size="small" color="#ef4444" /> : <Ionicons name="arrow-undo" size={16} color="#ef4444" />}
            <Text style={styles.revokeBtnText}>Revoke Approval</Text>
          </Pressable>
        )}
        {tab === "denied" && (
          <Pressable style={[styles.reApproveBtn, actioning && { opacity: 0.5 }]} onPress={onReApprove} disabled={actioning}>
            {actioning ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="arrow-undo" size={16} color="#000" />}
            <Text style={styles.reApproveBtnText}>Re-approve Score</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  rootView: { flex: 1, backgroundColor: "#080808" },
  safe:   { flex: 1 },
  loader: { flex: 1, backgroundColor: "#080808", alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub:   { color: "#444", fontSize: 12, marginTop: 1 },
  countBadge:  { minWidth: 28, height: 28, borderRadius: 14, backgroundColor: "#f59e0b", alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  countBadgeText: { color: "#000", fontWeight: "900", fontSize: 14 },

  // Main tabs (Reviews / Stats / Health)
  mainTabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
    paddingHorizontal: 16,
  },
  mainTabItem: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 13,
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  mainTabItemActive: { borderBottomColor: "#f59e0b" },
  mainTabLabel:      { color: "#444", fontSize: 13, fontWeight: "700" },
  mainTabLabelActive:{ color: "#f59e0b" },

  // Sub-tabs (Pending / Approved / Denied)
  subTabBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  subTabItem: {
    flex: 1, paddingVertical: 10, alignItems: "center",
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  subTabItemActive: { borderBottomColor: "#06b6d4" },
  subTabLabel:      { color: "#444", fontSize: 12, fontWeight: "700" },
  subTabLabelActive:{ color: "#06b6d4" },

  content: { padding: 16, paddingBottom: 40 },

  // Section headings inside stats/health
  sectionHeader: { marginTop: 8, marginBottom: 12 },
  sectionTitle:  { color: "#fff", fontSize: 16, fontWeight: "900" },
  sectionSub:    { color: "#444", fontSize: 12, marginTop: 2 },

  // Generic card
  card: {
    backgroundColor: "#111", borderRadius: 18,
    borderWidth: 1, borderColor: "#1e1e1e",
    marginBottom: 10, overflow: "hidden",
  },

  // Stat cards
  statRow:      { flexDirection: "row", gap: 10, marginBottom: 10 },
  statCard:     { flex: 1, padding: 16, alignItems: "center", gap: 4 },
  statCardWide: { flex: undefined, width: "100%", flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20 },
  statValue:    { fontSize: 28, fontWeight: "900" },
  statLabel:    { color: "#555", fontSize: 11, fontWeight: "700", textAlign: "center" },
  cardLabel:    { color: "#555", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  cardBigValue: { color: "#fff", fontSize: 40, fontWeight: "900" },
  cardSubLabel: { color: "#333", fontSize: 12, marginTop: 4 },

  // Breakdown bars
  breakdownRow:  { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  breakdownDot:  { width: 8, height: 8, borderRadius: 4 },
  breakdownLabel:{ flex: 1, color: "#fff", fontSize: 14, fontWeight: "700" },
  breakdownCount:{ color: "#888", fontSize: 14, fontWeight: "700" },
  breakdownPct:  { fontSize: 13, fontWeight: "900", minWidth: 36, textAlign: "right" },
  barBg:         { height: 6, backgroundColor: "#1e1e1e", borderRadius: 3, overflow: "hidden" },
  barFill:       { height: 6, borderRadius: 3 },

  // Player rows
  playerRow:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  playerRank: { color: "#333", fontSize: 13, fontWeight: "900", minWidth: 24, textAlign: "center" },
  playerName: { color: "#fff", fontSize: 14, fontWeight: "800" },
  playerSub:  { color: "#444", fontSize: 12, marginTop: 1 },

  // Health big stat
  bigPct:      { fontSize: 56, fontWeight: "900", letterSpacing: -2 },
  bigPctLabel: { color: "#fff", fontSize: 16, fontWeight: "800", marginTop: 4 },
  bigPctSub:   { color: "#444", fontSize: 12, marginTop: 4, textAlign: "center" },
  healthHintRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  healthHint:  { color: "#444", fontSize: 12, lineHeight: 18, flex: 1 },

  // Empty & error
  emptyState: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyIcon:  { width: 88, height: 88, borderRadius: 44, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { color: "#fff", fontSize: 20, fontWeight: "900" },
  emptySub:   { color: "#444", fontSize: 14 },
  inlineError:     { backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },
  inlineErrorText: { color: "#ef4444", fontSize: 13 },

  // Score cards
  statusBanner:     { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  statusBannerText: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  cardUser:     { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  cardUsername: { color: "#fff", fontSize: 15, fontWeight: "800" },
  cardGame:     { color: "#555", fontSize: 12, marginTop: 2 },
  cardScore:    { color: "#06b6d4", fontSize: 22, fontWeight: "900" },
  photoWrap:    { marginHorizontal: 16, marginBottom: 14, borderRadius: 14, overflow: "hidden" },
  photoThumb:   { width: "100%", height: 180 },
  photoTapHint: { position: "absolute", bottom: 8, right: 8, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  photoTapText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  noPhoto:      { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 14, backgroundColor: "#0a0a0a", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#1a1a1a" },
  noPhotoText:  { color: "#333", fontSize: 13 },
  cardActions:  { flexDirection: "row", gap: 10, padding: 16, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a" },

  denyBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderRadius: 14, backgroundColor: "rgba(239,68,68,0.1)", borderWidth: 1, borderColor: "rgba(239,68,68,0.25)" },
  denyBtnText: { color: "#ef4444", fontWeight: "800", fontSize: 15 },
  approveBtn:     { flex: 1.6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderRadius: 14, backgroundColor: "#22c55e" },
  approveBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },
  revokeBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: 14, backgroundColor: "rgba(239,68,68,0.08)", borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },
  revokeBtnText: { color: "#ef4444", fontWeight: "800", fontSize: 15 },
  reApproveBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: 14, backgroundColor: "#22c55e" },
  reApproveBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },

  // Confirm modal
  confirmBg:       { flex: 1, backgroundColor: "rgba(0,0,0,0.82)", justifyContent: "center", padding: 24 },
  confirmDismiss:  { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  confirmSheet:    { backgroundColor: "#111", borderRadius: 28, padding: 28, alignItems: "center", borderWidth: 1, borderColor: "#1e1e1e" },
  confirmIconWrap: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  confirmTitle:    { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 8, textAlign: "center" },
  confirmBody:     { color: "#555", fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 24 },
  confirmBtns:     { flexDirection: "row", gap: 10, width: "100%" },
  confirmCancel:   { flex: 1, backgroundColor: "#1a1a1a", borderRadius: 14, padding: 15, alignItems: "center" },
  confirmCancelText:  { color: "#888", fontWeight: "700" },
  confirmActionBtn:   { flex: 1, borderRadius: 14, padding: 15, alignItems: "center" },
  confirmActionText:  { fontWeight: "900" },

  // Admin teams list
  teamsCountRow:       { marginBottom: 12 },
  teamsCountText:      { color: "#444", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  adminTeamCard:       { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#111", borderRadius: 18, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: "#1e1e1e" },
  adminTeamAvatar:     { width: 44, height: 44, borderRadius: 13, backgroundColor: "rgba(6,182,212,0.08)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(6,182,212,0.15)" },
  adminTeamAvatarText: { color: "#06b6d4", fontSize: 13, fontWeight: "900" },
  adminTeamName:       { color: "#fff", fontSize: 15, fontWeight: "800", marginBottom: 3 },
  adminTeamMeta:       { color: "#555", fontSize: 12 },
  adminTeamDate:       { color: "#333", fontSize: 11, marginTop: 2 },
  deleteTeamBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(239,68,68,0.08)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },

  // Tournament request cards
  tournCard: {
    backgroundColor: "#111", borderRadius: 18,
    borderWidth: 1, borderColor: "#1e1e1e",
    padding: 16, marginBottom: 10,
  },
  tournCardTop:       { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  tournTitle:         { color: "#fff", fontSize: 15, fontWeight: "800", marginBottom: 2 },
  tournMeta:          { color: "#555", fontSize: 12 },
  tournDesc:          { color: "#666", fontSize: 13, lineHeight: 18, marginBottom: 10 },
  tournGameChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
    backgroundColor: "rgba(245,158,11,0.12)", borderWidth: 1, borderColor: "rgba(245,158,11,0.25)",
  },
  tournGameChipText:  { color: "#f59e0b", fontSize: 11, fontWeight: "700" },
  tournMeta2Row:      { flexDirection: "row", gap: 8, marginBottom: 12 },
  tournMetaChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
    backgroundColor: "#1a1a1a",
  },
  tournMetaChipText:  { color: "#888", fontSize: 11 },
  tournActions:       { flexDirection: "row", gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a", paddingTop: 12 },
  tournDenyBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 11, borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.08)", borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
  },
  tournDenyBtnText:    { color: "#ef4444", fontWeight: "800", fontSize: 14 },
  tournApproveBtn: {
    flex: 1.5, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 11, borderRadius: 14, backgroundColor: "#22c55e",
  },
  tournApproveBtnText: { color: "#000", fontWeight: "900", fontSize: 14 },
  confirmInput: {
    backgroundColor: "#0a0a0a", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    color: "#fff", fontSize: 14, borderWidth: 1, borderColor: "#222", width: "100%",
    minHeight: 60, textAlignVertical: "top",
  },

  // Manage tournaments
  manageHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  manageHeaderTitle: { color: "#fff", fontSize: 15, fontWeight: "800" },
  firstFridayBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#06b6d4", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  firstFridayBtnText: { color: "#000", fontWeight: "800", fontSize: 12 },
  manageTournCard: { backgroundColor: "#111", borderRadius: 16, borderWidth: 1, borderColor: "#1e1e1e", padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  manageTournTopRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4, flexShrink: 1 },
  manageTournTitle: { color: "#fff", fontSize: 14, fontWeight: "800", flex: 1 },
  manageTournStatus: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  manageTournStatusText: { fontSize: 10, fontWeight: "800" },
  manageTournDate: { color: "#555", fontSize: 12 },
  manageTournActions: { flexDirection: "row", gap: 6, alignItems: "center" },
  manageTournBtn: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: "rgba(6,182,212,0.1)", borderWidth: 1, borderColor: "rgba(6,182,212,0.2)" },
  manageTournBtnText: { color: "#06b6d4", fontSize: 12, fontWeight: "700" },
  manageTournResultsBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: "rgba(245,158,11,0.1)", borderWidth: 1, borderColor: "rgba(245,158,11,0.2)" },
  manageTournResultsText: { color: "#f59e0b", fontSize: 12, fontWeight: "700" },
  manageTournCompletedTag: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: "#1a1a1a" },
  manageTournCompletedText: { color: "#444", fontSize: 11, fontWeight: "700" },

  // Results modal
  modalBg:     { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalDismiss:{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  modalHandle: { width: 36, height: 4, backgroundColor: "#2a2a2a", borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  resultsSheet: { backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 0, borderTopWidth: 1, borderColor: "#1e1e1e", maxHeight: "85%" },
  resultsTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  resultsSub:   { color: "#555", fontSize: 13, marginBottom: 20 },
  resultRow:    { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  resultPlaceLabel: { color: "#888", fontSize: 15, fontWeight: "700", minWidth: 52 },
  resultInput:  { flex: 1, backgroundColor: "#0a0a0a", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: "#fff", fontSize: 14, borderWidth: 1, borderColor: "#222" },
  addPlaceBtn:  { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, marginBottom: 16 },
  addPlaceBtnText: { color: "#06b6d4", fontSize: 13, fontWeight: "700" },
  resultsBtns:  { flexDirection: "row", gap: 10, marginBottom: 8 },
  resultsSubmitBtn: { flex: 1, backgroundColor: "#f59e0b", borderRadius: 14, padding: 15, alignItems: "center" },
  resultsSubmitText: { color: "#000", fontWeight: "900" },

  // Photo modal
  photoModalBg:     { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center", padding: 20 },
  photoModalInner:  { backgroundColor: "#111", borderRadius: 24, borderWidth: 1, borderColor: "#1e1e1e", overflow: "hidden" },
  photoModalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e1e1e" },
  photoModalTitle:  { color: "#fff", fontSize: 16, fontWeight: "800" },
  photoModalImage:  { width: "100%", height: 420 },

  // Users tab
  userSearchInput: {
    backgroundColor: "#111", borderRadius: 14, borderWidth: 1, borderColor: "#1e1e1e",
    color: "#fff", fontSize: 14, paddingHorizontal: 16, paddingVertical: 12,
    marginBottom: 12,
  },
  userCard: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#111", borderRadius: 16, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: "#1e1e1e",
  },
  userCardName: { color: "#fff", fontSize: 14, fontWeight: "800", marginBottom: 4 },
  userRolePill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 8, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3,
    alignSelf: "flex-start",
  },
  userRolePillText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  userRoleActions: { flexDirection: "column", gap: 4, alignItems: "flex-end" },
  userRoleBtn: {
    backgroundColor: "#1a1a1a", borderRadius: 8, borderWidth: 1, borderColor: "#2a2a2a",
    paddingHorizontal: 10, paddingVertical: 5,
  },
  userRoleBtnText: { color: "#888", fontSize: 11, fontWeight: "700" },

  // Scheduler
  schedHeader: { marginBottom: 20 },
  schedWeekInput: {
    backgroundColor: "#111", borderRadius: 14, borderWidth: 1, borderColor: "#1e1e1e",
    color: "#fff", fontSize: 14, paddingHorizontal: 16, paddingVertical: 13,
    marginBottom: 10,
  },
  schedBtnRow: { flexDirection: "row", gap: 10 },
  schedAutoBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#f59e0b", borderRadius: 14, paddingVertical: 13,
  },
  schedAutoBtnText: { color: "#000", fontWeight: "900", fontSize: 14 },
  schedSaveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#06b6d4", borderRadius: 14, paddingVertical: 13, paddingHorizontal: 20,
  },
  schedSaveBtnText: { color: "#000", fontWeight: "900", fontSize: 14 },
  schedNoTeams: { color: "#444", fontSize: 13, textAlign: "center", marginTop: 12 },

  schedSlotSection: {
    backgroundColor: "#0d0d0d", borderRadius: 18, padding: 16,
    marginBottom: 14, borderWidth: 1, borderColor: "#1a1a1a",
  },
  schedSlotHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  schedSlotTime: { color: "#fff", fontSize: 16, fontWeight: "900", flex: 1 },
  schedSlotCount: {
    backgroundColor: "rgba(6,182,212,0.12)", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.3)",
  },
  schedSlotCountText: { color: "#06b6d4", fontSize: 12, fontWeight: "800" },
  schedEmptySlot: { color: "#333", fontSize: 13, fontStyle: "italic", paddingVertical: 6 },

  schedTeamCard: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#111", borderRadius: 14, padding: 12,
    marginBottom: 8, borderWidth: 1, borderColor: "#1e1e1e",
  },
  schedTeamLeft: { flex: 1 },
  schedTeamName: { color: "#fff", fontSize: 14, fontWeight: "800", marginBottom: 4 },
  schedTeamPrefs: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  schedPrefChip: {
    backgroundColor: "#1a1a1a", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: "#2a2a2a",
  },
  schedPrefChipMatch: { backgroundColor: "rgba(6,182,212,0.12)", borderColor: "rgba(6,182,212,0.4)" },
  schedPrefChip2Match: { backgroundColor: "rgba(99,102,241,0.12)", borderColor: "rgba(99,102,241,0.4)" },
  schedPrefChipText: { color: "#555", fontSize: 10, fontWeight: "700" },
  schedPrefChipTextMatch: { color: "#06b6d4" },
  schedPrefChip2MatchText: { color: "#6366f1" },
  schedTeamRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  schedTeamAvg: { color: "#444", fontSize: 12, fontWeight: "700" },

  modalSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40,
    borderTopWidth: 1, borderColor: "#1e1e1e",
  },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  modalSub:   { color: "#555", fontSize: 13, marginBottom: 20 },

  // Reassign modal (reuses modalBg / modalSheet / modalHandle / modalTitle / modalSub)
  schedReassignRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
    gap: 12,
  },
  schedReassignTime: { color: "#fff", fontSize: 16, fontWeight: "800", flex: 1 },
  schedReassignCount: { color: "#444", fontSize: 13 },
  schedRemoveBtn: {
    marginTop: 16, backgroundColor: "rgba(239,68,68,0.1)", borderRadius: 14,
    paddingVertical: 14, alignItems: "center",
    borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
  },
  schedRemoveBtnText: { color: "#ef4444", fontWeight: "800", fontSize: 15 },
});
