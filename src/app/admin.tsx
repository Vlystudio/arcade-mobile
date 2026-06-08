import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
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

type MainTab = "reviews" | "stats" | "health" | "teams" | "tournaments" | "users" | "forums" | "scheduler" | "support" | "karaoke" | "trivia";
type SupportTicket = { id: string; user_id: string; status: string; created_at: string; username: string; avatar_url: string | null };
type SupportMsg    = { id: string; sender_id: string; content: string; is_admin_msg: boolean; created_at: string };
type ReviewTab = "pending" | "approved" | "denied";

type ReviewScore = {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  game_name: string;
  score: number;
  photo_url: string | null;
  proof_storage_path: string | null;
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
  is_individual: boolean;
  signup_qr_token: string | null;
  signup_qr_active: boolean;
  signup_qr_issued_at: string | null;
  max_players: number;
  registered_count: number;
  ff_signup_time: string | null;
  ff_start_time: string | null;
  has_bracket: boolean;
  created_at: string;
};

type BracketSlot  = { user_id: string; username: string; seed: number; status: string; eliminated_game: number | null; final_rank: number | null };
type BracketScore = { user_id: string; username: string; score: number; rank_in_game: number; rank_points: number | null; is_eliminated: boolean; player_seed: number | null };
type BracketGame  = { id: string; game_number: number; status: string; scores: BracketScore[] | null };
type BracketGroup = { id: string; group_number: number; status: string; slots: BracketSlot[] | null; games: BracketGame[] | null };
type BracketRound = { id: string; round_number: number; round_name: string; status: string; groups: BracketGroup[] | null };

type AdminTriviaQuestion = {
  id: string;
  question: string;
  question_type: "multiple_choice" | "text";
  options: { id: string; text: string }[];
  correct_answer: string;
  points: number;
  category: string | null;
  created_at: string;
};

type AdminTriviaGame = {
  id: string;
  title: string;
  status: "lobby" | "active" | "finished";
  current_question_index: number;
  max_participants: number;
  allow_teams: boolean;
  min_team_size: number;
  signup_token: string;
  participant_count?: number;
  created_at: string;
};

type TriviaParticipant = {
  id: string;
  display_name: string;
  participant_type: "individual" | "team";
  score: number;
  user_id: string | null;
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
  { key: "support",     label: "Support",     icon: "headset-outline" },
  { key: "karaoke",     label: "Karaoke",     icon: "mic-outline" },
  { key: "trivia",      label: "Trivia",      icon: "help-circle-outline" },
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
  const [proofUrlLoading, setProofUrlLoading] = useState(false);

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
  const [editTournTarget, setEditTournTarget] = useState<ManageTournament | null>(null);
  const [editTournForm, setEditTournForm] = useState({ title: "", game_type: "", proposed_date: "", max_players: "32", signup_time: "", start_time: "" });
  const [editingTourn, setEditingTourn] = useState(false);
  const [deleteTournTarget, setDeleteTournTarget] = useState<ManageTournament | null>(null);
  const [deletingTourn, setDeletingTourn] = useState(false);
  const [resultsTarget, setResultsTarget] = useState<ManageTournament | null>(null);
  const [resultEntries, setResultEntries] = useState<{ place: number; username: string }[]>([
    { place: 1, username: "" }, { place: 2, username: "" }, { place: 3, username: "" },
  ]);
  const [savingResults, setSavingResults] = useState(false);
  const [resultsWarnings, setResultsWarnings] = useState<string[]>([]);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [tournError, setTournError] = useState<string | null>(null);
  const [qrGenerating, setQrGenerating] = useState<string | null>(null);
  const [qrRevoking, setQrRevoking] = useState<string | null>(null);
  // Bracket
  const [bracketTournId, setBracketTournId]         = useState<string | null>(null);
  const [bracketData, setBracketData]               = useState<{ rounds: BracketRound[] | null } | null>(null);
  const [bracketLoading, setBracketLoading]         = useState(false);
  const [bracketRoundTab, setBracketRoundTab]       = useState(1);
  const [generatingBracket, setGeneratingBracket]   = useState<string | null>(null);
  const [scoringGame, setScoringGame]               = useState<{ game: BracketGame; group: BracketGroup; round: BracketRound; isEditing: boolean } | null>(null);
  const [bracketWinners, setBracketWinners]         = useState<BracketSlot[] | null>(null);
  const [gameScores, setGameScores]                 = useState<Record<string, string>>({});
  const [submittingScores, setSubmittingScores]     = useState(false);
  // Guest player management
  const [guestTargetId, setGuestTargetId]   = useState<string | null>(null);
  const [guestName, setGuestName]           = useState("");
  const [addingGuest, setAddingGuest]       = useState(false);
  const [guestList, setGuestList]           = useState<{ id: string; guest_name: string }[]>([]);
  const [guestListLoading, setGuestListLoading] = useState(false);

  // Karaoke queue management
  type KaraokeItem = { id: string; video_id: string; title: string; channel: string; thumbnail_url: string | null; requester_name: string; status: string; created_at: string };
  const [karaokeQueue, setKaraokeQueue]         = useState<KaraokeItem[]>([]);
  const [karaokeHistory, setKaraokeHistory]     = useState<KaraokeItem[]>([]);
  const [karaokeLoading, setKaraokeLoading]     = useState(false);
  const [karaokeActioning, setKaraokeActioning] = useState<string | null>(null);
  const [clearingHistory, setClearingHistory]   = useState(false);
  const [showHistory, setShowHistory]           = useState(false);
  const [karaokeError, setKaraokeError]         = useState<string | null>(null);

  // Trivia state
  const [triviaQuestions, setTriviaQuestions]   = useState<AdminTriviaQuestion[]>([]);
  const [triviaGames, setTriviaGames]           = useState<AdminTriviaGame[]>([]);
  const [triviaLoading, setTriviaLoading]       = useState(false);
  const [triviaTab, setTriviaTab]               = useState<"questions" | "games">("games");
  const [triviaError, setTriviaError]           = useState<string | null>(null);
  // New question form
  const [qForm, setQForm] = useState({ question: "", type: "multiple_choice" as "multiple_choice" | "text", optA: "", optB: "", optC: "", optD: "", correct: "a", points: "100", category: "" });
  const [savingQuestion, setSavingQuestion]     = useState(false);
  const [editingQuestion, setEditingQuestion]   = useState<AdminTriviaQuestion | null>(null);
  const [deletingQuestion, setDeletingQuestion] = useState<string | null>(null);
  // New game form
  const [gForm, setGForm] = useState({ title: "Trivia Night", maxParticipants: "20", allowTeams: true, minTeamSize: "3", selectedQuestions: [] as string[] });
  const [creatingGame, setCreatingGame]         = useState(false);
  const [triviaGameActioning, setTriviaGameActioning] = useState<string | null>(null);
  const [triviaQrGame, setTriviaQrGame]         = useState<AdminTriviaGame | null>(null);
  const [showNewGameForm, setShowNewGameForm]   = useState(false);
  const [triviaParticipants, setTriviaParticipants] = useState<Record<string, TriviaParticipant[]>>({});
  const [expandedGamePlayers, setExpandedGamePlayers] = useState<string | null>(null);
  const [kickingParticipant, setKickingParticipant] = useState<string | null>(null);

  // Player list management (all tournaments)
  type RegPlayer = { id: string; user_id: string | null; guest_name: string | null; username: string; status: string };
  const [playerListTarget, setPlayerListTarget] = useState<ManageTournament | null>(null);
  const [playerList, setPlayerList]             = useState<RegPlayer[]>([]);
  const [playerListLoading, setPlayerListLoading] = useState(false);
  const [removingPlayer, setRemovingPlayer]     = useState<string | null>(null);
  const [playerListError, setPlayerListError]   = useState<string | null>(null);

  // Forums state
  type PendingForum = { id: string; title: string; description: string | null; game_type: string | null; creator_username: string; created_at: string; auto_flagged: boolean; flag_category: string | null };
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

  // Support inbox state
  const [supportTickets, setSupportTickets]   = useState<SupportTicket[]>([]);
  const [supportLoading, setSupportLoading]   = useState(false);
  const [selectedTicket, setSelectedTicket]   = useState<SupportTicket | null>(null);
  const [ticketMessages, setTicketMessages]   = useState<SupportMsg[]>([]);
  const [msgsLoading, setMsgsLoading]         = useState(false);
  const [supportReply, setSupportReply]       = useState("");
  const [supportReplying, setSupportReplying] = useState(false);
  const [resolving, setResolving]             = useState(false);
  const [unreadSupport, setUnreadSupport]     = useState(0);
  const supportScrollRef = useRef<ScrollView>(null);

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
    if (mainTab === "support") { loadSupportTickets(); setUnreadSupport(0); }
    if (mainTab === "karaoke") loadKaraokeQueue();
    if (mainTab === "trivia") loadTriviaData();
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

  // Realtime: badge for new user support messages
  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase
      .channel("admin-support-watch")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages" },
        (payload) => {
          const msg = payload.new as SupportMsg;
          if (msg.is_admin_msg) return;
          if (mainTab === "support" && selectedTicket?.id === (payload.new as any).ticket_id) {
            setTicketMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
            setTimeout(() => supportScrollRef.current?.scrollToEnd({ animated: true }), 100);
          } else {
            setUnreadSupport(n => n + 1);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, mainTab, selectedTicket]);

  // Realtime: live karaoke queue updates while on the karaoke tab
  useEffect(() => {
    if (!isAdmin || mainTab !== "karaoke") return;
    const ch = supabase
      .channel("admin-karaoke-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "karaoke_queue" }, loadKaraokeQueue)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, mainTab]);

  async function checkAdminAndLoad() {
    const { data } = await supabase.from("profiles").select("role").eq("id", user!.id).single();
    const role = data?.role ?? "user";
    if (!["admin", "owner", "architect"].includes(role)) { router.replace("/"); return; }
    setIsAdmin(true);
    setUserRole(role);
    setChecking(false);
  }

  async function loadSupportTickets() {
    setSupportLoading(true);
    setSelectedTicket(null);
    setTicketMessages([]);
    const { data: tickets } = await supabase
      .from("support_tickets")
      .select("id, user_id, status, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: false });
    if (tickets?.length) {
      const userIds = [...new Set(tickets.map(t => t.user_id))];
      const { data: profiles } = await supabase
        .from("profiles").select("id, username, avatar_url").in("id", userIds);
      const pMap: Record<string, { username: string; avatar_url: string | null }> = {};
      profiles?.forEach(p => { pMap[p.id] = p; });
      setSupportTickets(tickets.map(t => ({
        ...t,
        username: pMap[t.user_id]?.username ?? "Unknown",
        avatar_url: pMap[t.user_id]?.avatar_url ?? null,
      })));
    } else {
      setSupportTickets([]);
    }
    setSupportLoading(false);
  }

  async function openTicket(ticket: SupportTicket) {
    setSelectedTicket(ticket);
    setMsgsLoading(true);
    const { data } = await supabase
      .from("support_messages")
      .select("id, sender_id, content, is_admin_msg, created_at")
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: true });
    setTicketMessages(data ?? []);
    setMsgsLoading(false);
    setTimeout(() => supportScrollRef.current?.scrollToEnd({ animated: false }), 150);
  }

  async function handleAdminReply() {
    const trimmed = supportReply.trim();
    if (!trimmed || !selectedTicket || supportReplying) return;
    setSupportReplying(true);
    setSupportReply("");
    const { data, error } = await supabase.rpc("rpc_admin_reply_support", {
      p_ticket_id: selectedTicket.id,
      p_content:   trimmed,
    });
    if (error || (data as any)?.error) {
      setSupportReply(trimmed);
    } else {
      const { data: msgs } = await supabase
        .from("support_messages")
        .select("id, sender_id, content, is_admin_msg, created_at")
        .eq("ticket_id", selectedTicket.id)
        .order("created_at", { ascending: true });
      setTicketMessages(msgs ?? []);
      setTimeout(() => supportScrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
    setSupportReplying(false);
  }

  async function handleResolveTicket() {
    if (!selectedTicket || resolving) return;
    setResolving(true);
    await supabase.rpc("rpc_resolve_support_ticket", { p_ticket_id: selectedTicket.id });
    setResolving(false);
    setSelectedTicket(null);
    loadSupportTickets();
  }

  async function loadUsers() {
    setUsersLoading(true);
    setUsersError(null);
    const { data, error } = await supabase.rpc("rpc_admin_get_users");
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
      .select("id, user_id, score, photo_url, proof_storage_path, created_at, profiles(username, avatar_url), games(name)")
      .eq("status", tab)
      .order("created_at", { ascending: tab === "pending" });

    setScores((data ?? []).map((row: any) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const game    = Array.isArray(row.games)    ? row.games[0]    : row.games;
      return {
        id: row.id, user_id: row.user_id,
        username:           profile?.username          ?? "Unknown",
        avatar_url:         profile?.avatar_url        ?? null,
        game_name:          game?.name                 ?? "Unknown Game",
        score:              row.score,
        photo_url:          row.photo_url              ?? null,
        proof_storage_path: row.proof_storage_path     ?? null,
        created_at:         row.created_at,
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

  async function handlePhotoPress(score: ReviewScore) {
    if (score.proof_storage_path) {
      setProofUrlLoading(true);
      const { data } = await supabase.storage
        .from("score-proofs")
        .createSignedUrl(score.proof_storage_path, 3600);
      setProofUrlLoading(false);
      if (data?.signedUrl) setPhotoModal(data.signedUrl);
    } else if (score.photo_url) {
      setPhotoModal(score.photo_url);
    }
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
      .select("id, title, description, game_type, creator_id, created_at, auto_flagged, flag_category")
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
      auto_flagged:  f.auto_flagged  ?? false,
      flag_category: f.flag_category ?? null,
    })));
    setForumsLoading(false);
  }

  async function handleForumAction(forumId: string, newStatus: "approved" | "rejected") {
    setForumsError(null);
    setActioningForum(forumId);
    const { data, error } = await supabase.rpc("rpc_admin_update_forum_status", {
      p_forum_id: forumId,
      p_status:   newStatus,
    });
    const rpcError = error?.message ?? (data as any)?.error ?? null;
    if (rpcError) { setForumsError(typeof rpcError === "string" ? rpcError : JSON.stringify(rpcError)); }
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
    const [{ data }, { data: regData }, { data: bracketRows }] = await Promise.all([
      supabase
        .from("tournaments")
        .select("id, title, game_type, status, proposed_date, is_official, is_individual, signup_qr_token, signup_qr_active, signup_qr_issued_at, max_players, ff_signup_time, ff_start_time, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("tournament_registrations")
        .select("tournament_id")
        .eq("status", "accepted"),
      supabase
        .from("ff_bracket_rounds")
        .select("tournament_id"),
    ]);
    const regCount: Record<string, number> = {};
    for (const r of regData ?? []) regCount[(r as any).tournament_id] = (regCount[(r as any).tournament_id] ?? 0) + 1;
    const bracketSet = new Set((bracketRows ?? []).map((r: any) => r.tournament_id));
    setManageTournaments((data ?? []).map((t: any) => ({
      ...t,
      is_individual:   t.is_individual ?? false,
      signup_qr_token: t.signup_qr_token ?? null,
      signup_qr_active: t.signup_qr_active ?? false,
      max_players:     t.max_players ?? 32,
      ff_signup_time:  t.ff_signup_time ?? "7:30 PM",
      ff_start_time:   t.ff_start_time  ?? "8:00 PM",
      registered_count: regCount[t.id] ?? 0,
      has_bracket:     bracketSet.has(t.id),
    })));
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

  async function handleGenerateQR(tournamentId: string) {
    setTournError(null);
    setQrGenerating(tournamentId);
    const { data, error } = await supabase.rpc("rpc_admin_generate_ff_signup_qr", {
      p_tournament_id: tournamentId,
    });
    setQrGenerating(null);
    if (error) { setTournError(error.message); return; }
    const result = data as any;
    if (result?.error) { setTournError(result.message ?? result.error); return; }
    setManageTournaments((prev) => prev.map((t) =>
      t.id === tournamentId
        ? { ...t, signup_qr_active: true, signup_qr_token: result.token, signup_qr_issued_at: new Date().toISOString() }
        : t
    ));
  }

  async function handleEditTournament() {
    if (!editTournTarget) return;
    setTournError(null);
    setEditingTourn(true);
    const maxP = parseInt(editTournForm.max_players, 10);
    const proposedDate = editTournForm.proposed_date.trim()
      ? (() => { const d = new Date(editTournForm.proposed_date.trim()); return isNaN(d.getTime()) ? null : d.toISOString(); })()
      : null;
    const { data, error } = await supabase.rpc("rpc_admin_update_tournament", {
      p_tournament_id: editTournTarget.id,
      p_title:         editTournForm.title.trim() || editTournTarget.title,
      p_game_type:     editTournForm.game_type.trim() || null,
      p_proposed_date: proposedDate,
      p_max_players:   isNaN(maxP) ? editTournTarget.max_players : maxP,
      p_signup_time:   editTournForm.signup_time.trim() || null,
      p_start_time:    editTournForm.start_time.trim()  || null,
    });
    if (error) { setTournError(error.message); }
    else if ((data as any)?.error) { setTournError((data as any).message ?? (data as any).error); }
    else {
      setManageTournaments(prev => prev.map(t =>
        t.id === editTournTarget.id ? {
          ...t,
          title:          editTournForm.title.trim() || t.title,
          game_type:      editTournForm.game_type.trim() || null,
          proposed_date:  proposedDate ?? t.proposed_date,
          max_players:    isNaN(maxP) ? t.max_players : maxP,
          ff_signup_time: editTournForm.signup_time.trim() || t.ff_signup_time,
          ff_start_time:  editTournForm.start_time.trim()  || t.ff_start_time,
        } : t
      ));
      setEditTournTarget(null);
    }
    setEditingTourn(false);
  }

  async function handleDeleteTournament() {
    if (!deleteTournTarget) return;
    setTournError(null);
    setDeletingTourn(true);
    const { data, error } = await supabase.rpc("rpc_admin_delete_tournament", {
      p_tournament_id: deleteTournTarget.id,
    });
    if (error) { setTournError(error.message); }
    else if ((data as any)?.error) { setTournError((data as any).message ?? (data as any).error); }
    else {
      setManageTournaments(prev => prev.filter(t => t.id !== deleteTournTarget.id));
      setDeleteTournTarget(null);
    }
    setDeletingTourn(false);
  }

  async function loadBracket(tournamentId: string): Promise<any> {
    setBracketLoading(true);
    const { data, error } = await supabase.rpc("rpc_ff_get_bracket", { p_tournament_id: tournamentId });
    if (!error && data) {
      setBracketData(data as any);
      const rounds: BracketRound[] = (data as any)?.rounds ?? [];
      const activeRound = rounds.find(r => r.status === "in_progress") ?? rounds[rounds.length - 1];
      if (activeRound) setBracketRoundTab(activeRound.round_number);
    }
    setBracketLoading(false);
    return data;
  }

  async function handleGenerateBracket(tournamentId: string) {
    setGeneratingBracket(tournamentId);
    setTournError(null);
    const { data, error } = await supabase.rpc("rpc_ff_generate_bracket", { p_tournament_id: tournamentId });
    setGeneratingBracket(null);
    if (error) { setTournError(error.message); return; }
    if ((data as any)?.error) { setTournError((data as any).message ?? (data as any).error); return; }
    setManageTournaments(prev => prev.map(t => t.id === tournamentId ? { ...t, has_bracket: true, status: "active" } : t));
    setBracketTournId(tournamentId);
    loadBracket(tournamentId);
  }

  async function handleSubmitGameScores() {
    if (!scoringGame) return;
    setSubmittingScores(true);
    const players = scoringGame.isEditing
      ? scoringGame.game.game_number === 1
        ? (scoringGame.group.slots ?? [])
        : (scoringGame.group.slots ?? []).filter(s => s.eliminated_game !== 1)
      : (scoringGame.group.slots ?? []).filter(s => s.status === "active");
    const scores = players.map(p => ({ user_id: p.user_id, seed: p.seed, score: parseInt(gameScores[String(p.seed)] ?? "0", 10) }));
    const { data, error } = await supabase.rpc("rpc_ff_submit_game_scores", {
      p_game_id: scoringGame.game.id,
      p_scores:  scores,
    });
    setSubmittingScores(false);
    if (error) { setTournError(error.message); return; }
    if ((data as any)?.error) { setTournError((data as any).message ?? (data as any).error); return; }
    setScoringGame(null);
    setGameScores({});
    let freshData: any = null;
    if (bracketTournId) freshData = await loadBracket(bracketTournId);
    if ((data as any)?.tournament_complete) {
      setManageTournaments(prev => prev.map(t => t.id === bracketTournId ? { ...t, status: "completed" } : t));
      const finalRound = (freshData?.rounds as BracketRound[])?.find((r: BracketRound) => r.round_number === 4);
      const winners = [...((finalRound?.groups?.[0]?.slots as BracketSlot[]) ?? [])]
        .filter(sl => sl.final_rank != null)
        .sort((a, b) => (a.final_rank ?? 0) - (b.final_rank ?? 0));
      if (winners.length > 0) setBracketWinners(winners);
    }
  }

  async function openGuestManager(tournamentId: string) {
    setGuestTargetId(tournamentId);
    setGuestName("");
    setGuestListLoading(true);
    const { data } = await supabase.rpc("rpc_ff_get_guest_players", { p_tournament_id: tournamentId });
    setGuestList((data as any)?.guests ?? []);
    setGuestListLoading(false);
  }

  async function handleAddGuest() {
    if (!guestTargetId || !guestName.trim()) return;
    setAddingGuest(true);
    const { data, error } = await supabase.rpc("rpc_admin_add_ff_guest", {
      p_tournament_id: guestTargetId,
      p_guest_name: guestName.trim(),
    });
    setAddingGuest(false);
    if (error || (data as any)?.error) {
      setTournError((data as any)?.error ?? error?.message ?? "Failed to add guest");
      return;
    }
    setGuestName("");
    const { data: gl } = await supabase.rpc("rpc_ff_get_guest_players", { p_tournament_id: guestTargetId });
    setGuestList((gl as any)?.guests ?? []);
    await loadManageTournaments();
  }

  async function handleRemoveGuest(regId: string) {
    if (!guestTargetId) return;
    await supabase.rpc("rpc_admin_remove_ff_guest", { p_reg_id: regId });
    setGuestList(prev => prev.filter(g => g.id !== regId));
    await loadManageTournaments();
  }

  async function openPlayerManager(t: ManageTournament) {
    setPlayerListTarget(t);
    setPlayerListError(null);
    setPlayerList([]);
    setPlayerListLoading(true);
    const { data, error } = await supabase
      .from("tournament_registrations")
      .select("id, user_id, guest_name, status, profiles(username)")
      .eq("tournament_id", t.id)
      .order("created_at", { ascending: true });
    if (error) { setPlayerListError(error.message); }
    else {
      setPlayerList((data ?? []).map((r: any) => ({
        id: r.id,
        user_id: r.user_id ?? null,
        guest_name: r.guest_name ?? null,
        username: r.profiles?.username ?? r.guest_name ?? "Unknown",
        status: r.status,
      })));
    }
    setPlayerListLoading(false);
  }

  async function handleRemovePlayer(regId: string) {
    setRemovingPlayer(regId);
    setPlayerListError(null);
    const { data } = await supabase.rpc("rpc_admin_remove_tournament_player", { p_reg_id: regId });
    if ((data as any)?.error) {
      setPlayerListError((data as any).message ?? (data as any).error);
    } else {
      setPlayerList(prev => prev.filter(p => p.id !== regId));
      await loadManageTournaments();
    }
    setRemovingPlayer(null);
  }

  // ── Karaoke ────────────────────────────────────────────────────────────────

  async function loadKaraokeQueue() {
    setKaraokeLoading(true);
    setKaraokeError(null);
    const [{ data: active }, { data: hist }] = await Promise.all([
      supabase
        .from("karaoke_queue")
        .select("id, video_id, title, channel, thumbnail_url, requester_name, status, created_at")
        .in("status", ["playing", "queued"])
        .order("created_at", { ascending: true }),
      supabase
        .from("karaoke_queue")
        .select("id, video_id, title, channel, thumbnail_url, requester_name, status, created_at")
        .in("status", ["played", "skipped"])
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setKaraokeQueue(active ?? []);
    setKaraokeHistory(hist ?? []);
    setKaraokeLoading(false);
  }

  async function handleKaraokeSkip(songId: string) {
    setKaraokeActioning(songId);
    const { data } = await supabase.rpc("rpc_karaoke_skip", { p_song_id: songId });
    if ((data as any)?.error) setKaraokeError((data as any).error);
    await loadKaraokeQueue();
    setKaraokeActioning(null);
  }

  async function handleKaraokeRemove(songId: string) {
    setKaraokeActioning(songId);
    const { data } = await supabase.rpc("rpc_karaoke_remove", { p_song_id: songId });
    if ((data as any)?.error) setKaraokeError((data as any).error);
    await loadKaraokeQueue();
    setKaraokeActioning(null);
  }

  async function handleKaraokeClearHistory() {
    setClearingHistory(true);
    await supabase.rpc("rpc_karaoke_clear_history");
    await loadKaraokeQueue();
    setShowHistory(false);
    setClearingHistory(false);
  }

  // ── Trivia ──────────────────────────────────────────────────────────────────

  async function loadTriviaData() {
    setTriviaLoading(true);
    setTriviaError(null);
    const [{ data: questions }, { data: games }] = await Promise.all([
      supabase.from("trivia_questions").select("*").order("created_at", { ascending: false }),
      supabase.from("trivia_games").select("*").order("created_at", { ascending: false }),
    ]);
    if (questions) {
      const withCounts = await Promise.all(
        (games ?? []).map(async (g) => {
          const { count } = await supabase.from("trivia_participants").select("id", { count: "exact", head: true }).eq("game_id", g.id);
          return { ...g, participant_count: count ?? 0 };
        })
      );
      setTriviaQuestions(questions as AdminTriviaQuestion[]);
      setTriviaGames(withCounts as AdminTriviaGame[]);
    }
    setTriviaLoading(false);
  }

  async function handleSaveQuestion() {
    setSavingQuestion(true);
    setTriviaError(null);
    const opts = qForm.type === "multiple_choice"
      ? [
          { id: "a", text: qForm.optA.trim() },
          { id: "b", text: qForm.optB.trim() },
          qForm.optC.trim() ? { id: "c", text: qForm.optC.trim() } : null,
          qForm.optD.trim() ? { id: "d", text: qForm.optD.trim() } : null,
        ].filter(Boolean)
      : [];

    if (editingQuestion) {
      const { error } = await supabase.from("trivia_questions").update({
        question: qForm.question.trim(),
        question_type: qForm.type,
        options: opts,
        correct_answer: qForm.correct,
        points: parseInt(qForm.points) || 100,
        category: qForm.category.trim() || null,
      }).eq("id", editingQuestion.id);
      if (error) { setTriviaError(error.message); setSavingQuestion(false); return; }
    } else {
      const { error } = await supabase.from("trivia_questions").insert({
        question: qForm.question.trim(),
        question_type: qForm.type,
        options: opts,
        correct_answer: qForm.correct,
        points: parseInt(qForm.points) || 100,
        category: qForm.category.trim() || null,
        created_by: user!.id,
      });
      if (error) { setTriviaError(error.message); setSavingQuestion(false); return; }
    }
    setSavingQuestion(false);
    setEditingQuestion(null);
    setQForm({ question: "", type: "multiple_choice", optA: "", optB: "", optC: "", optD: "", correct: "a", points: "100", category: "" });
    await loadTriviaData();
  }

  async function handleDeleteQuestion(id: string) {
    setDeletingQuestion(id);
    await supabase.from("trivia_questions").delete().eq("id", id);
    setDeletingQuestion(null);
    setTriviaQuestions(prev => prev.filter(q => q.id !== id));
  }

  async function handleCreateGame() {
    if (!gForm.title.trim() || gForm.selectedQuestions.length === 0) {
      setTriviaError("Enter a title and select at least one question.");
      return;
    }
    setCreatingGame(true);
    setTriviaError(null);
    const { data, error } = await supabase.rpc("rpc_admin_trivia_create_game", {
      p_title: gForm.title.trim(),
      p_max_participants: parseInt(gForm.maxParticipants) || 20,
      p_allow_teams: gForm.allowTeams,
      p_min_team_size: parseInt(gForm.minTeamSize) || 3,
      p_question_ids: gForm.selectedQuestions,
    });
    setCreatingGame(false);
    if (error || (data as any)?.error) {
      setTriviaError((data as any)?.error ?? error?.message ?? "Failed to create game.");
      return;
    }
    setShowNewGameForm(false);
    setGForm({ title: "Trivia Night", maxParticipants: "20", allowTeams: true, minTeamSize: "3", selectedQuestions: [] });
    await loadTriviaData();
  }

  async function handleTriviaGameAction(gameId: string, action: "start" | "next" | "end" | "delete") {
    setTriviaGameActioning(gameId);
    const rpc = action === "start" ? "rpc_admin_trivia_start_game"
      : action === "next" ? "rpc_admin_trivia_next_question"
      : action === "end" ? "rpc_admin_trivia_end_game"
      : "rpc_admin_trivia_delete_game";
    const { error } = await supabase.rpc(rpc, { p_game_id: gameId });
    setTriviaGameActioning(null);
    if (error) { setTriviaError(error.message); return; }
    await loadTriviaData();
  }

  async function handleGradeAnswer(answerId: string, isCorrect: boolean) {
    await supabase.rpc("rpc_admin_trivia_grade", { p_answer_id: answerId, p_is_correct: isCorrect });
  }

  async function loadGameParticipants(gameId: string) {
    const { data } = await supabase
      .from("trivia_participants")
      .select("id, display_name, participant_type, score, user_id")
      .eq("game_id", gameId)
      .order("score", { ascending: false });
    setTriviaParticipants(prev => ({ ...prev, [gameId]: (data ?? []) as TriviaParticipant[] }));
  }

  async function kickTriviaParticipant(gameId: string, participantId: string) {
    setKickingParticipant(participantId);
    await supabase.from("trivia_participants").delete().eq("id", participantId);
    setTriviaParticipants(prev => ({
      ...prev,
      [gameId]: (prev[gameId] ?? []).filter(p => p.id !== participantId),
    }));
    setTriviaGames(prev => prev.map(g =>
      g.id === gameId ? { ...g, participant_count: Math.max(0, (g.participant_count ?? 1) - 1) } : g
    ));
    setKickingParticipant(null);
  }

  async function handleRevokeQR(tournamentId: string) {
    setTournError(null);
    setQrRevoking(tournamentId);
    const { data, error } = await supabase.rpc("rpc_admin_revoke_ff_signup_qr", {
      p_tournament_id: tournamentId,
    });
    setQrRevoking(null);
    if (error) { setTournError(error.message); return; }
    const result = data as any;
    if (result?.error) { setTournError(result.message ?? result.error); return; }
    setManageTournaments((prev) => prev.map((t) =>
      t.id === tournamentId ? { ...t, signup_qr_active: false } : t
    ));
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
              : mainTab === "support" ? "Support inbox"
              : mainTab === "karaoke" ? "Monitor & moderate the queue"
              : mainTab === "trivia" ? "Question bank & live games"
              : "Business health"}
          </Text>
        </View>
        {mainTab === "reviews" && reviewTab === "pending" && scores.length > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{scores.length}</Text>
          </View>
        )}
        {mainTab !== "support" && unreadSupport > 0 && (
          <View style={[styles.countBadge, { backgroundColor: "#06b6d4" }]}>
            <Text style={styles.countBadgeText}>{unreadSupport}</Text>
          </View>
        )}
      </View>

      {/* Main tab bar — swipe left/right to see all tabs */}
      <View style={styles.mainTabBarWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.mainTabBar}
          contentContainerStyle={styles.mainTabBarContent}
        >
          {MAIN_TABS.filter((t) => t.key !== "users" || userRole === "owner" || userRole === "architect").map(({ key, label, icon }) => (
            <Pressable
              key={key}
              style={[styles.mainTabItem, mainTab === key && styles.mainTabItemActive]}
              onPress={() => setMainTab(key as MainTab)}
            >
              <View>
                <Ionicons name={icon as any} size={16} color={mainTab === key ? "#f59e0b" : "#444"} />
                {key === "support" && unreadSupport > 0 && mainTab !== "support" && (
                  <View style={styles.tabUnreadDot} />
                )}
              </View>
              <Text style={[styles.mainTabLabel, mainTab === key && styles.mainTabLabelActive]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {/* Right-edge fade hints that more tabs are off-screen */}
        <View style={styles.mainTabFadeRight} pointerEvents="none" />
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
                    proofLoading={proofUrlLoading}
                    onApprove={() => handleDirectApprove(item)}
                    onDeny={() => requestConfirm(item, "deny")}
                    onRevoke={() => requestConfirm(item, "revoke")}
                    onReApprove={() => requestConfirm(item, "reapprove")}
                    onPhotoPress={() => handlePhotoPress(item)}
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
                        <View style={styles.manageTournInnerRow}>
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
                          {t.status === "upcoming" && !t.is_individual && (
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
                          <Pressable
                            style={styles.manageTournIconBtn}
                            onPress={() => {
                              setEditTournForm({
                                title: t.title,
                                game_type: t.game_type ?? "",
                                proposed_date: t.proposed_date
                                  ? new Date(t.proposed_date).toISOString().slice(0, 10)
                                  : "",
                                max_players: String(t.max_players),
                                signup_time: t.ff_signup_time ?? "7:30 PM",
                                start_time:  t.ff_start_time  ?? "8:00 PM",
                              });
                              setEditTournTarget(t);
                            }}
                          >
                            <Ionicons name="create-outline" size={15} color="#888" />
                          </Pressable>
                          <Pressable
                            style={[styles.manageTournIconBtn, { borderColor: "rgba(239,68,68,0.25)", backgroundColor: "rgba(239,68,68,0.06)" }]}
                            onPress={() => setDeleteTournTarget(t)}
                          >
                            <Ionicons name="trash-outline" size={15} color="#ef4444" />
                          </Pressable>
                        </View>
                        </View>

                        {/* Player roster button — all tournaments */}
                        <Pressable
                          style={styles.manageTournPlayersBtn}
                          onPress={() => openPlayerManager(t)}
                        >
                          <Ionicons name="people-outline" size={13} color="#06b6d4" />
                          <Text style={styles.manageTournPlayersBtnText}>
                            Players ({t.registered_count})
                          </Text>
                          <Ionicons name="chevron-forward" size={13} color="#06b6d4" />
                        </Pressable>

                        {/* First Friday times display */}
                        {t.is_individual && t.game_type === "Skee-Ball" && (
                          <View style={styles.ffTimesRow}>
                            <Ionicons name="time-outline" size={12} color="#555" />
                            <Text style={styles.ffTimesText}>Sign-up {t.ff_signup_time ?? "7:30 PM"} · Starts {t.ff_start_time ?? "8:00 PM"}</Text>
                          </View>
                        )}

                        {/* First Friday bracket section */}
                        {t.is_individual && t.game_type === "Skee-Ball" && (
                          <View style={styles.ffBracketSection}>
                            <View style={styles.ffBracketHeader}>
                              <Ionicons name="git-branch-outline" size={13} color="#a855f7" />
                              <Text style={styles.ffBracketLabel}>Bracket</Text>
                              <Text style={styles.ffBracketCount}>{t.registered_count}/{t.max_players} players</Text>
                            </View>
                            {!t.has_bracket && (
                              <Pressable
                                style={styles.ffAddGuestBtn}
                                onPress={() => openGuestManager(t.id)}
                              >
                                <Ionicons name="person-add-outline" size={13} color="#22c55e" />
                                <Text style={styles.ffAddGuestBtnText}>Add Guest Player</Text>
                              </Pressable>
                            )}
                            {!t.has_bracket && t.registered_count < 32 && (
                              <Text style={styles.ffBracketHint}>Need {32 - t.registered_count} more players to generate bracket (set max players to 32)</Text>
                            )}
                            {!t.has_bracket && t.registered_count >= 32 && (
                              <Pressable
                                style={[styles.ffBracketGenBtn, generatingBracket === t.id && { opacity: 0.5 }]}
                                onPress={() => handleGenerateBracket(t.id)}
                                disabled={generatingBracket === t.id}
                              >
                                {generatingBracket === t.id
                                  ? <ActivityIndicator size="small" color="#000" />
                                  : <><Ionicons name="shuffle-outline" size={13} color="#000" /><Text style={styles.ffBracketGenBtnText}>Generate Bracket</Text></>}
                              </Pressable>
                            )}
                            {t.has_bracket && (
                              <Pressable
                                style={styles.ffBracketOpenBtn}
                                onPress={() => { setBracketTournId(t.id); loadBracket(t.id); }}
                              >
                                <Ionicons name="trophy-outline" size={13} color="#a855f7" />
                                <Text style={styles.ffBracketOpenBtnText}>Manage Bracket</Text>
                              </Pressable>
                            )}
                          </View>
                        )}

                        {/* First Friday QR Section */}
                        {t.is_individual && t.game_type === "Skee-Ball" && (t.status === "upcoming" || t.status === "active") && (
                          <View style={styles.ffQrSection}>
                            <View style={styles.ffQrHeaderRow}>
                              <Ionicons name="qr-code-outline" size={13} color="#06b6d4" />
                              <Text style={styles.ffQrLabel}>Sign-up QR</Text>
                              <Text style={styles.ffQrCount}>{t.registered_count}/{t.max_players} players</Text>
                              <View style={[
                                styles.ffQrStatusChip,
                                t.signup_qr_active
                                  ? { backgroundColor: "rgba(34,197,94,0.08)", borderColor: "rgba(34,197,94,0.25)" }
                                  : { backgroundColor: "rgba(85,85,85,0.08)", borderColor: "rgba(85,85,85,0.2)" },
                              ]}>
                                <View style={[styles.ffQrDot, { backgroundColor: t.signup_qr_active ? "#22c55e" : "#333" }]} />
                                <Text style={[styles.ffQrStatusText, { color: t.signup_qr_active ? "#22c55e" : "#444" }]}>
                                  {t.signup_qr_active ? "OPEN" : "LOCKED"}
                                </Text>
                              </View>
                            </View>

                            {t.signup_qr_active && t.signup_qr_token && (
                              <View style={styles.ffQrImageWrap}>
                                <Image
                                  source={{ uri: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent("arcadetracker://ff-signup?token=" + t.signup_qr_token)}&bgcolor=111111&color=ffffff&qzone=2` }}
                                  style={styles.ffQrImage}
                                  contentFit="contain"
                                />
                                <Text style={styles.ffQrHint}>Players scan this QR to register</Text>
                              </View>
                            )}

                            <View style={styles.ffQrBtnRow}>
                              <Pressable
                                style={[styles.ffGenerateBtn, (qrGenerating === t.id || qrRevoking === t.id) && { opacity: 0.5 }]}
                                onPress={() => handleGenerateQR(t.id)}
                                disabled={qrGenerating === t.id || qrRevoking === t.id}
                              >
                                {qrGenerating === t.id
                                  ? <ActivityIndicator size="small" color="#000" />
                                  : <><Ionicons name="qr-code" size={13} color="#000" /><Text style={styles.ffGenerateBtnText}>Generate QR</Text></>
                                }
                              </Pressable>
                              {t.signup_qr_active && (
                                <Pressable
                                  style={[styles.ffRevokeBtn, (qrGenerating === t.id || qrRevoking === t.id) && { opacity: 0.5 }]}
                                  onPress={() => handleRevokeQR(t.id)}
                                  disabled={qrGenerating === t.id || qrRevoking === t.id}
                                >
                                  {qrRevoking === t.id
                                    ? <ActivityIndicator size="small" color="#ef4444" />
                                    : <Text style={styles.ffRevokeBtnText}>Lock QR</Text>
                                  }
                                </Pressable>
                              )}
                            </View>
                          </View>
                        )}
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

      {/* ── Support Inbox ── */}
      {mainTab === "support" && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
          {selectedTicket ? (
            <View style={{ flex: 1 }}>
              {/* Conversation header */}
              <View style={styles.suppConvHeader}>
                <Pressable style={styles.suppBackBtn} onPress={() => { setSelectedTicket(null); setTicketMessages([]); }}>
                  <Ionicons name="arrow-back" size={18} color="#fff" />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={styles.suppConvUser}>{selectedTicket.username}</Text>
                  <Text style={styles.suppConvSub}>Open ticket · {new Date(selectedTicket.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</Text>
                </View>
                <Pressable
                  style={[styles.suppResolveBtn, resolving && { opacity: 0.5 }]}
                  onPress={handleResolveTicket}
                  disabled={resolving}
                >
                  <Text style={styles.suppResolveBtnText}>Resolve</Text>
                </Pressable>
              </View>

              {/* Messages */}
              <ScrollView
                ref={supportScrollRef}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.suppMsgList}
              >
                {msgsLoading ? (
                  <ActivityIndicator color="#06b6d4" style={{ marginTop: 40 }} />
                ) : ticketMessages.map(msg => (
                  <View key={msg.id} style={[styles.suppMsgRow, msg.is_admin_msg ? styles.suppMsgRowAdmin : styles.suppMsgRowUser]}>
                    <View style={[styles.suppBubble, msg.is_admin_msg ? styles.suppBubbleAdmin : styles.suppBubbleUser]}>
                      {msg.is_admin_msg && <Text style={styles.suppAdminLabel}>Support Team</Text>}
                      <Text style={[styles.suppBubbleText, msg.is_admin_msg ? styles.suppBubbleTextAdmin : styles.suppBubbleTextUser]}>
                        {msg.content}
                      </Text>
                      <Text style={[styles.suppBubbleTime, msg.is_admin_msg ? styles.suppTimeAdmin : styles.suppTimeUser]}>
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </Text>
                    </View>
                  </View>
                ))}
              </ScrollView>

              {/* Reply input */}
              <View style={styles.suppReplyRow}>
                <TextInput
                  style={styles.suppReplyInput}
                  placeholder="Reply…"
                  placeholderTextColor="#333"
                  value={supportReply}
                  onChangeText={setSupportReply}
                  multiline
                  maxLength={4000}
                  returnKeyType="default"
                />
                <Pressable
                  style={[styles.suppSendBtn, (!supportReply.trim() || supportReplying) && styles.suppSendBtnOff]}
                  onPress={handleAdminReply}
                  disabled={!supportReply.trim() || supportReplying}
                >
                  {supportReplying
                    ? <ActivityIndicator size="small" color="#000" />
                    : <Ionicons name="send" size={16} color="#000" />
                  }
                </Pressable>
              </View>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              {supportLoading ? (
                <ActivityIndicator color="#06b6d4" style={{ marginTop: 60 }} />
              ) : supportTickets.length === 0 ? (
                <EmptyState title="No open tickets" sub="All support requests have been resolved." icon="checkmark-circle-outline" color="#22c55e" />
              ) : supportTickets.map(ticket => (
                <Pressable key={ticket.id} style={styles.suppTicketCard} onPress={() => openTicket(ticket)}>
                  <View style={styles.suppTicketAvatar}>
                    <Ionicons name="person-outline" size={18} color="#06b6d4" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.suppTicketUser}>{ticket.username}</Text>
                    <Text style={styles.suppTicketTime}>
                      {new Date(ticket.created_at).toLocaleDateString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#333" />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </KeyboardAvoidingView>
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
            placeholder="Search by username or email…"
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
              .filter((u) => {
                if (!userSearch) return true;
                const q = userSearch.toLowerCase();
                return u.username?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
              })
              .map((u) => {
                const displayName = u.username ?? u.email ?? "Unknown";
                const cfg: Record<string, { color: string }> = {
                  architect: { color: "#a855f7" },
                  owner:     { color: "#f59e0b" },
                  admin:     { color: "#3b82f6" },
                  user:      { color: "#444" },
                };
                const color = cfg[u.role]?.color ?? "#444";
                const availableRoles = userRole === "architect"
                  ? ["user", "admin", "owner"]
                  : ["user", "admin"];
                return (
                  <View key={u.id} style={styles.userCard}>
                    <Avatar uri={u.avatar_url} name={displayName} size={42} radius={13} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.userCardName}>{displayName}</Text>
                      {!u.username && u.email && (
                        <Text style={styles.userCardEmail}>{u.email}</Text>
                      )}
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
                        {forum.auto_flagged && (
                          <View style={styles.modFlagBadge}>
                            <Ionicons name="warning-outline" size={12} color="#f59e0b" />
                            <Text style={styles.modFlagText}>
                              Auto-flagged · {forum.flag_category === "hate_speech" ? "hate speech" : forum.flag_category ?? "content"}
                            </Text>
                          </View>
                        )}
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

      {/* ── Karaoke ── */}
      {mainTab === "karaoke" && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={false} onRefresh={loadKaraokeQueue} tintColor="#a855f7" />}
        >
          {/* Toolbar */}
          <View style={styles.karaokeToolbar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.karaokeQueueCount}>
                {karaokeQueue.filter(q => q.status === "queued").length} queued
                {karaokeQueue.some(q => q.status === "playing") ? "  ·  1 playing" : ""}
              </Text>
            </View>
            <Pressable
              style={[styles.karaokeHistoryBtn, clearingHistory && { opacity: 0.5 }]}
              onPress={handleKaraokeClearHistory}
              disabled={clearingHistory}
            >
              {clearingHistory
                ? <ActivityIndicator size="small" color="#555" />
                : <><Ionicons name="trash-outline" size={13} color="#555" /><Text style={styles.karaokeHistoryBtnText}>Clear History</Text></>
              }
            </Pressable>
          </View>

          {!!karaokeError && (
            <View style={styles.inlineError}>
              <Text style={styles.inlineErrorText}>{karaokeError}</Text>
            </View>
          )}

          {karaokeLoading ? (
            <ActivityIndicator color="#a855f7" style={{ marginTop: 40 }} />
          ) : karaokeQueue.length === 0 ? (
            <EmptyState title="Queue is empty" sub="No songs playing or queued right now." icon="mic-outline" color="#a855f7" />
          ) : (
            <>
              {/* Now Playing */}
              {karaokeQueue.filter(q => q.status === "playing").map(song => (
                <View key={song.id} style={styles.karaokeNowCard}>
                  <View style={styles.karaokeNowBadge}>
                    <Ionicons name="musical-notes" size={11} color="#000" />
                    <Text style={styles.karaokeNowBadgeText}>NOW PLAYING</Text>
                  </View>
                  <View style={styles.karaokeNowRow}>
                    {song.thumbnail_url
                      ? <Image source={{ uri: song.thumbnail_url }} style={styles.karaokeNowThumb} contentFit="cover" />
                      : <View style={[styles.karaokeNowThumb, styles.karaokeThumbPlaceholder]}><Ionicons name="musical-note" size={20} color="#333" /></View>
                    }
                    <View style={{ flex: 1 }}>
                      <Text style={styles.karaokeNowTitle} numberOfLines={2}>{song.title}</Text>
                      {!!song.channel && <Text style={styles.karaokeNowChannel}>{song.channel}</Text>}
                      <Text style={styles.karaokeNowRequester}>By {song.requester_name}</Text>
                      <Pressable
                        style={styles.karaokeYtLink}
                        onPress={() => { if (typeof window !== "undefined") window.open(`https://youtube.com/watch?v=${song.video_id}`, "_blank"); }}
                      >
                        <Ionicons name="logo-youtube" size={12} color="#ef4444" />
                        <Text style={styles.karaokeYtLinkText}>Preview on YouTube</Text>
                      </Pressable>
                    </View>
                    <Pressable
                      style={[styles.karaokeSkipBtn, karaokeActioning === song.id && { opacity: 0.5 }]}
                      onPress={() => handleKaraokeSkip(song.id)}
                      disabled={karaokeActioning === song.id}
                    >
                      {karaokeActioning === song.id
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <><Ionicons name="play-skip-forward" size={14} color="#fff" /><Text style={styles.karaokeSkipBtnText}>Skip</Text></>
                      }
                    </Pressable>
                  </View>
                </View>
              ))}

              {/* Queued songs */}
              {karaokeQueue.filter(q => q.status === "queued").length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Up Next</Text>
                  {karaokeQueue.filter(q => q.status === "queued").map((song, idx) => (
                    <View key={song.id} style={styles.karaokeQueueItem}>
                      <Text style={styles.karaokeQueuePos}>{idx + 1}</Text>
                      {song.thumbnail_url
                        ? <Image source={{ uri: song.thumbnail_url }} style={styles.karaokeQueueThumb} contentFit="cover" />
                        : <View style={[styles.karaokeQueueThumb, styles.karaokeThumbPlaceholder]}><Ionicons name="musical-note" size={13} color="#333" /></View>
                      }
                      <View style={styles.karaokeQueueInfo}>
                        <Text style={styles.karaokeQueueTitle} numberOfLines={1}>{song.title}</Text>
                        <Text style={styles.karaokeQueueMeta} numberOfLines={1}>
                          {song.channel ? `${song.channel} · ` : ""}By {song.requester_name}
                        </Text>
                        <Pressable
                          style={styles.karaokeYtLink}
                          onPress={() => { if (typeof window !== "undefined") window.open(`https://youtube.com/watch?v=${song.video_id}`, "_blank"); }}
                        >
                          <Ionicons name="logo-youtube" size={11} color="#ef4444" />
                          <Text style={styles.karaokeYtLinkText}>Preview</Text>
                        </Pressable>
                      </View>
                      <Pressable
                        style={[styles.karaokeRemoveBtn, karaokeActioning === song.id && { opacity: 0.5 }]}
                        onPress={() => handleKaraokeRemove(song.id)}
                        disabled={karaokeActioning === song.id}
                        hitSlop={8}
                      >
                        {karaokeActioning === song.id
                          ? <ActivityIndicator size="small" color="#ef4444" />
                          : <Ionicons name="close-circle" size={20} color="#ef4444" />
                        }
                      </Pressable>
                    </View>
                  ))}
                </>
              )}
            </>
          )}

          {/* History toggle */}
          <Pressable style={styles.karaokeHistoryToggle} onPress={() => setShowHistory(v => !v)}>
            <Ionicons name={showHistory ? "chevron-up" : "chevron-down"} size={14} color="#555" />
            <Text style={styles.karaokeHistoryToggleText}>
              {showHistory ? "Hide" : "Show"} history ({karaokeHistory.length})
            </Text>
          </Pressable>

          {showHistory && karaokeHistory.map(song => (
            <View key={song.id} style={[styles.karaokeQueueItem, { opacity: 0.5 }]}>
              <Ionicons
                name={song.status === "skipped" ? "ban-outline" : "checkmark-circle-outline"}
                size={16}
                color={song.status === "skipped" ? "#ef4444" : "#22c55e"}
                style={{ marginRight: 4 }}
              />
              {song.thumbnail_url
                ? <Image source={{ uri: song.thumbnail_url }} style={styles.karaokeQueueThumb} contentFit="cover" />
                : <View style={[styles.karaokeQueueThumb, styles.karaokeThumbPlaceholder]}><Ionicons name="musical-note" size={13} color="#333" /></View>
              }
              <View style={styles.karaokeQueueInfo}>
                <Text style={styles.karaokeQueueTitle} numberOfLines={1}>{song.title}</Text>
                <Text style={styles.karaokeQueueMeta} numberOfLines={1}>
                  By {song.requester_name} · {song.status === "skipped" ? "skipped" : "played"}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* ── Trivia ── */}
      {mainTab === "trivia" && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={false} onRefresh={loadTriviaData} tintColor="#06b6d4" />}
        >
          {/* Sub-tab switcher */}
          <View style={styles.triviaTabRow}>
            <Pressable style={[styles.triviaTabBtn, triviaTab === "games" && styles.triviaTabBtnActive]} onPress={() => setTriviaTab("games")}>
              <Ionicons name="game-controller-outline" size={14} color={triviaTab === "games" ? "#06b6d4" : "#555"} />
              <Text style={[styles.triviaTabBtnText, triviaTab === "games" && { color: "#06b6d4" }]}>Games</Text>
            </Pressable>
            <Pressable style={[styles.triviaTabBtn, triviaTab === "questions" && styles.triviaTabBtnActive]} onPress={() => setTriviaTab("questions")}>
              <Ionicons name="help-circle-outline" size={14} color={triviaTab === "questions" ? "#06b6d4" : "#555"} />
              <Text style={[styles.triviaTabBtnText, triviaTab === "questions" && { color: "#06b6d4" }]}>Question Bank</Text>
            </Pressable>
          </View>

          {!!triviaError && (
            <View style={styles.inlineError}>
              <Text style={styles.inlineErrorText}>{triviaError}</Text>
            </View>
          )}

          {triviaLoading ? (
            <ActivityIndicator color="#06b6d4" style={{ marginTop: 40 }} />
          ) : triviaTab === "games" ? (
            <>
              {/* Create game button */}
              <Pressable style={styles.triviaCreateBtn} onPress={() => { setTriviaError(null); setShowNewGameForm(v => !v); }}>
                <Ionicons name={showNewGameForm ? "chevron-up" : "add-circle-outline"} size={16} color="#06b6d4" />
                <Text style={styles.triviaCreateBtnText}>{showNewGameForm ? "Cancel" : "Create New Game"}</Text>
              </Pressable>

              {showNewGameForm && (
                <View style={styles.triviaFormCard}>
                  <Text style={styles.triviaFormLabel}>Game Title</Text>
                  <TextInput
                    style={styles.triviaFormInput}
                    value={gForm.title}
                    onChangeText={v => setGForm(f => ({ ...f, title: v }))}
                    placeholderTextColor="#333"
                  />
                  <View style={styles.triviaFormRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.triviaFormLabel}>Max Players</Text>
                      <TextInput style={styles.triviaFormInput} keyboardType="number-pad" value={gForm.maxParticipants} onChangeText={v => setGForm(f => ({ ...f, maxParticipants: v }))} placeholderTextColor="#333" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.triviaFormLabel}>Min Team Size</Text>
                      <TextInput style={styles.triviaFormInput} keyboardType="number-pad" value={gForm.minTeamSize} onChangeText={v => setGForm(f => ({ ...f, minTeamSize: v }))} placeholderTextColor="#333" />
                    </View>
                  </View>
                  <View style={styles.triviaToggleRow}>
                    <Text style={styles.triviaFormLabel}>Allow Teams</Text>
                    <Pressable
                      style={[styles.triviaToggle, gForm.allowTeams && styles.triviaToggleOn]}
                      onPress={() => setGForm(f => ({ ...f, allowTeams: !f.allowTeams }))}
                    >
                      <View style={[styles.triviaToggleThumb, gForm.allowTeams && styles.triviaToggleThumbOn]} />
                    </Pressable>
                  </View>
                  <Text style={[styles.triviaFormLabel, { marginTop: 8 }]}>Select Questions ({gForm.selectedQuestions.length} selected)</Text>
                  {triviaQuestions.length === 0 && (
                    <Text style={styles.triviaEmpty}>No questions in bank. Add some in the Question Bank tab.</Text>
                  )}
                  {triviaQuestions.map(q => (
                    <Pressable
                      key={q.id}
                      style={[styles.triviaQPickRow, gForm.selectedQuestions.includes(q.id) && styles.triviaQPickRowSelected]}
                      onPress={() => {
                        setGForm(f => ({
                          ...f,
                          selectedQuestions: f.selectedQuestions.includes(q.id)
                            ? f.selectedQuestions.filter(id => id !== q.id)
                            : [...f.selectedQuestions, q.id],
                        }));
                      }}
                    >
                      <View style={[styles.triviaCheckbox, gForm.selectedQuestions.includes(q.id) && styles.triviaCheckboxChecked]}>
                        {gForm.selectedQuestions.includes(q.id) && <Ionicons name="checkmark" size={11} color="#000" />}
                      </View>
                      <Text style={styles.triviaQPickText} numberOfLines={2}>{q.question}</Text>
                      <Text style={styles.triviaQPickType}>{q.question_type === "multiple_choice" ? "MC" : "Text"}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    style={[styles.triviaSaveBtn, creatingGame && { opacity: 0.5 }]}
                    onPress={handleCreateGame}
                    disabled={creatingGame}
                  >
                    {creatingGame
                      ? <ActivityIndicator color="#000" size="small" />
                      : <Text style={styles.triviaSaveBtnText}>Create Game</Text>
                    }
                  </Pressable>
                </View>
              )}

              {/* Active games */}
              {triviaGames.length === 0 ? (
                <EmptyState title="No trivia games" sub="Create one above to get started." icon="help-circle-outline" color="#06b6d4" />
              ) : (
                triviaGames.map(game => (
                  <View key={game.id} style={styles.triviaGameCard}>
                    <View style={styles.triviaGameCardTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.triviaGameTitle}>{game.title}</Text>
                        <Text style={styles.triviaGameMeta}>
                          {game.participant_count ?? 0}/{game.max_participants} players · Q{game.current_question_index}
                          {game.allow_teams ? ` · Teams (min ${game.min_team_size})` : " · Individual"}
                        </Text>
                      </View>
                      <View style={[styles.triviaStatusBadge, {
                        backgroundColor: game.status === "lobby" ? "rgba(245,158,11,0.15)" : game.status === "active" ? "rgba(34,197,94,0.15)" : "rgba(85,85,85,0.15)",
                      }]}>
                        <Text style={[styles.triviaStatusText, {
                          color: game.status === "lobby" ? "#f59e0b" : game.status === "active" ? "#22c55e" : "#555",
                        }]}>
                          {game.status.toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    {/* QR code */}
                    {game.status === "lobby" && (
                      <View style={styles.triviaQrRow}>
                        <Pressable style={styles.triviaQrBtn} onPress={() => setTriviaQrGame(game)}>
                          <Ionicons name="qr-code-outline" size={14} color="#06b6d4" />
                          <Text style={styles.triviaQrBtnText}>Show QR</Text>
                        </Pressable>
                      </View>
                    )}

                    {/* Players panel */}
                    <Pressable
                      style={styles.triviaPlayersToggle}
                      onPress={() => {
                        if (expandedGamePlayers === game.id) {
                          setExpandedGamePlayers(null);
                        } else {
                          setExpandedGamePlayers(game.id);
                          loadGameParticipants(game.id);
                        }
                      }}
                    >
                      <Ionicons name="people-outline" size={14} color="#888" />
                      <Text style={styles.triviaPlayersToggleText}>
                        Players ({game.participant_count ?? 0})
                      </Text>
                      <Ionicons
                        name={expandedGamePlayers === game.id ? "chevron-up" : "chevron-down"}
                        size={14}
                        color="#555"
                      />
                    </Pressable>

                    {expandedGamePlayers === game.id && (
                      <View style={styles.triviaPlayersList}>
                        {(triviaParticipants[game.id] ?? []).length === 0 ? (
                          <Text style={styles.triviaPlayersEmpty}>No players joined yet.</Text>
                        ) : (
                          (triviaParticipants[game.id] ?? []).map(p => (
                            <View key={p.id} style={styles.triviaPlayerRow}>
                              <View style={styles.triviaPlayerAvatar}>
                                <Text style={styles.triviaPlayerAvatarText}>
                                  {p.display_name[0].toUpperCase()}
                                </Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.triviaPlayerName}>{p.display_name}</Text>
                                <Text style={styles.triviaPlayerMeta}>
                                  {p.participant_type === "team" ? "Team" : "Individual"} · {p.score} pts
                                </Text>
                              </View>
                              <Pressable
                                style={[styles.triviaKickBtn, kickingParticipant === p.id && { opacity: 0.4 }]}
                                onPress={() =>
                                  Alert.alert(
                                    "Kick Player",
                                    `Remove ${p.display_name} from this game?`,
                                    [
                                      { text: "Cancel", style: "cancel" },
                                      { text: "Kick", style: "destructive", onPress: () => kickTriviaParticipant(game.id, p.id) },
                                    ]
                                  )
                                }
                                disabled={kickingParticipant === p.id}
                              >
                                {kickingParticipant === p.id
                                  ? <ActivityIndicator size="small" color="#ef4444" />
                                  : <Ionicons name="person-remove-outline" size={16} color="#ef4444" />
                                }
                              </Pressable>
                            </View>
                          ))
                        )}
                      </View>
                    )}

                    {/* Action buttons */}
                    <View style={styles.triviaGameActions}>
                      {game.status === "lobby" && (
                        <Pressable
                          style={[styles.triviaActionBtn, { backgroundColor: "rgba(34,197,94,0.12)", borderColor: "rgba(34,197,94,0.3)" }, triviaGameActioning === game.id && { opacity: 0.5 }]}
                          onPress={() => handleTriviaGameAction(game.id, "start")}
                          disabled={triviaGameActioning === game.id}
                        >
                          <Ionicons name="play" size={13} color="#22c55e" />
                          <Text style={[styles.triviaActionBtnText, { color: "#22c55e" }]}>Start</Text>
                        </Pressable>
                      )}
                      {game.status === "active" && (
                        <>
                          <Pressable
                            style={[styles.triviaActionBtn, { backgroundColor: "rgba(6,182,212,0.12)", borderColor: "rgba(6,182,212,0.3)" }, triviaGameActioning === game.id && { opacity: 0.5 }]}
                            onPress={() => handleTriviaGameAction(game.id, "next")}
                            disabled={triviaGameActioning === game.id}
                          >
                            <Ionicons name="play-skip-forward" size={13} color="#06b6d4" />
                            <Text style={[styles.triviaActionBtnText, { color: "#06b6d4" }]}>Next Q</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.triviaActionBtn, { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.25)" }, triviaGameActioning === game.id && { opacity: 0.5 }]}
                            onPress={() => handleTriviaGameAction(game.id, "end")}
                            disabled={triviaGameActioning === game.id}
                          >
                            <Ionicons name="stop" size={13} color="#ef4444" />
                            <Text style={[styles.triviaActionBtnText, { color: "#ef4444" }]}>End</Text>
                          </Pressable>
                        </>
                      )}
                      {game.status === "finished" && (
                        <Pressable
                          style={[styles.triviaActionBtn, { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.25)" }, triviaGameActioning === game.id && { opacity: 0.5 }]}
                          onPress={() => handleTriviaGameAction(game.id, "delete")}
                          disabled={triviaGameActioning === game.id}
                        >
                          <Ionicons name="trash-outline" size={13} color="#ef4444" />
                          <Text style={[styles.triviaActionBtnText, { color: "#ef4444" }]}>Delete</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                ))
              )}
            </>
          ) : (
            /* ── Question Bank ── */
            <>
              {/* Add / edit question form */}
              <View style={styles.triviaFormCard}>
                <Text style={styles.triviaFormTitle}>{editingQuestion ? "Edit Question" : "Add Question"}</Text>
                <Text style={styles.triviaFormLabel}>Question</Text>
                <TextInput
                  style={[styles.triviaFormInput, { minHeight: 60, textAlignVertical: "top" }]}
                  multiline
                  placeholder="Enter question text..."
                  placeholderTextColor="#333"
                  value={qForm.question}
                  onChangeText={v => setQForm(f => ({ ...f, question: v }))}
                />
                <Text style={styles.triviaFormLabel}>Type</Text>
                <View style={styles.triviaTypeRow}>
                  {(["multiple_choice", "text"] as const).map(t => (
                    <Pressable
                      key={t}
                      style={[styles.triviaTypeBtn, qForm.type === t && styles.triviaTypeBtnActive]}
                      onPress={() => setQForm(f => ({ ...f, type: t }))}
                    >
                      <Text style={[styles.triviaTypeBtnText, qForm.type === t && { color: "#06b6d4" }]}>
                        {t === "multiple_choice" ? "Multiple Choice" : "Written Answer"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {qForm.type === "multiple_choice" && (
                  <>
                    {(["optA", "optB", "optC", "optD"] as const).map((key, i) => (
                      <View key={key} style={styles.triviaOptRow}>
                        <Pressable
                          style={[styles.triviaOptLetter, qForm.correct === ["a","b","c","d"][i] && styles.triviaOptLetterCorrect]}
                          onPress={() => setQForm(f => ({ ...f, correct: ["a","b","c","d"][i] }))}
                        >
                          <Text style={[styles.triviaOptLetterText, qForm.correct === ["a","b","c","d"][i] && { color: "#000" }]}>
                            {["A","B","C","D"][i]}
                          </Text>
                        </Pressable>
                        <TextInput
                          style={[styles.triviaFormInput, { flex: 1, marginBottom: 0 }]}
                          placeholder={`Option ${["A","B","C","D"][i]}${i < 2 ? " (required)" : " (optional)"}`}
                          placeholderTextColor="#333"
                          value={qForm[key]}
                          onChangeText={v => setQForm(f => ({ ...f, [key]: v }))}
                        />
                      </View>
                    ))}
                    <Text style={[styles.triviaFormLabel, { fontSize: 11, color: "#444" }]}>Tap a letter to mark it as correct answer</Text>
                  </>
                )}
                {qForm.type === "text" && (
                  <>
                    <Text style={styles.triviaFormLabel}>Correct Answer</Text>
                    <TextInput
                      style={styles.triviaFormInput}
                      placeholder="Expected answer (for auto-grading)"
                      placeholderTextColor="#333"
                      value={qForm.correct}
                      onChangeText={v => setQForm(f => ({ ...f, correct: v }))}
                    />
                  </>
                )}
                <View style={styles.triviaFormRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.triviaFormLabel}>Points</Text>
                    <TextInput style={styles.triviaFormInput} keyboardType="number-pad" value={qForm.points} onChangeText={v => setQForm(f => ({ ...f, points: v }))} placeholderTextColor="#333" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.triviaFormLabel}>Category</Text>
                    <TextInput style={styles.triviaFormInput} placeholder="e.g. History" placeholderTextColor="#333" value={qForm.category} onChangeText={v => setQForm(f => ({ ...f, category: v }))} />
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {editingQuestion && (
                    <Pressable style={styles.triviaDiscardBtn} onPress={() => {
                      setEditingQuestion(null);
                      setQForm({ question: "", type: "multiple_choice", optA: "", optB: "", optC: "", optD: "", correct: "a", points: "100", category: "" });
                    }}>
                      <Text style={styles.triviaDiscardBtnText}>Cancel</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={[styles.triviaSaveBtn, { flex: 1 }, savingQuestion && { opacity: 0.5 }]}
                    onPress={handleSaveQuestion}
                    disabled={savingQuestion}
                  >
                    {savingQuestion
                      ? <ActivityIndicator color="#000" size="small" />
                      : <Text style={styles.triviaSaveBtnText}>{editingQuestion ? "Save Changes" : "Add Question"}</Text>
                    }
                  </Pressable>
                </View>
              </View>

              {/* Question list */}
              {triviaQuestions.length === 0 ? (
                <EmptyState title="No questions yet" sub="Add questions above to build your bank." icon="help-circle-outline" color="#06b6d4" />
              ) : (
                triviaQuestions.map(q => (
                  <View key={q.id} style={styles.triviaQCard}>
                    <View style={styles.triviaQCardTop}>
                      <View style={{ flex: 1 }}>
                        {q.category && <Text style={styles.triviaQCategory}>{q.category}</Text>}
                        <Text style={styles.triviaQText}>{q.question}</Text>
                        <Text style={styles.triviaQMeta}>
                          {q.question_type === "multiple_choice" ? "Multiple Choice" : "Written"} · {q.points} pts
                        </Text>
                      </View>
                      <View style={styles.triviaQActions}>
                        <Pressable
                          onPress={() => {
                            setEditingQuestion(q);
                            const opts: Record<string, string> = {};
                            (q.options ?? []).forEach((o: any) => { opts[`opt${o.id.toUpperCase()}`] = o.text; });
                            setQForm({
                              question: q.question,
                              type: q.question_type,
                              optA: opts.optA ?? "",
                              optB: opts.optB ?? "",
                              optC: opts.optC ?? "",
                              optD: opts.optD ?? "",
                              correct: q.correct_answer,
                              points: String(q.points),
                              category: q.category ?? "",
                            });
                          }}
                          hitSlop={8}
                        >
                          <Ionicons name="pencil-outline" size={16} color="#06b6d4" />
                        </Pressable>
                        <Pressable
                          onPress={() => handleDeleteQuestion(q.id)}
                          disabled={deletingQuestion === q.id}
                          hitSlop={8}
                        >
                          {deletingQuestion === q.id
                            ? <ActivityIndicator size="small" color="#ef4444" />
                            : <Ionicons name="trash-outline" size={16} color="#ef4444" />
                          }
                        </Pressable>
                      </View>
                    </View>
                    {q.question_type === "multiple_choice" && q.options.length > 0 && (
                      <View style={styles.triviaQOpts}>
                        {q.options.map((o: any) => (
                          <View key={o.id} style={[styles.triviaQOpt, o.id === q.correct_answer && styles.triviaQOptCorrect]}>
                            <Text style={[styles.triviaQOptText, o.id === q.correct_answer && { color: "#22c55e" }]}>
                              {o.id.toUpperCase()}. {o.text}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ))
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* ── Trivia QR Modal ── */}
      <Modal visible={!!triviaQrGame} transparent animationType="fade" onRequestClose={() => setTriviaQrGame(null)}>
        <View style={styles.confirmBg}>
          <Pressable style={styles.confirmDismiss} onPress={() => setTriviaQrGame(null)} />
          <View style={[styles.confirmSheet, { alignItems: "center" }]}>
            <Text style={styles.confirmTitle}>{triviaQrGame?.title}</Text>
            <Text style={[styles.confirmBody, { marginBottom: 16 }]}>Players scan this to sign up</Text>
            {triviaQrGame && (
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              <Image
                source={{ uri: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(`${process.env.EXPO_PUBLIC_APP_URL ?? "https://arcadetracker.app"}/trivia-join?token=${triviaQrGame.signup_token}`)}` }}
                style={{ width: 220, height: 220, borderRadius: 12 }}
                contentFit="contain"
              />
            )}
            <Text style={[styles.confirmBody, { marginTop: 12, fontSize: 11 }]}>
              Token: {triviaQrGame?.signup_token?.slice(0, 8)}…
            </Text>
            <Pressable style={[styles.confirmCancel, { marginTop: 16, alignSelf: "stretch" }]} onPress={() => setTriviaQrGame(null)}>
              <Text style={styles.confirmCancelText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

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

      {/* Edit tournament modal */}
      <Modal visible={!!editTournTarget} transparent animationType="slide" onRequestClose={() => setEditTournTarget(null)}>
        <View style={[styles.confirmBg, { justifyContent: "flex-end", padding: 0 }]}>
          <Pressable style={styles.confirmDismiss} onPress={() => setEditTournTarget(null)} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}
            scrollEnabled={false}
          >
          <View style={styles.editTournSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.editTournTitle}>Edit Tournament</Text>
            <Text style={styles.editTournSub}>"{editTournTarget?.title}"</Text>

            <Text style={styles.editTournLabel}>Title</Text>
            <TextInput
              style={styles.editTournInput}
              placeholder={editTournTarget?.title ?? "Title"}
              placeholderTextColor="#333"
              value={editTournForm.title}
              onChangeText={v => setEditTournForm(f => ({ ...f, title: v }))}
            />

            <Text style={styles.editTournLabel}>Game Type</Text>
            <TextInput
              style={styles.editTournInput}
              placeholder="e.g. pinball"
              placeholderTextColor="#333"
              value={editTournForm.game_type}
              onChangeText={v => setEditTournForm(f => ({ ...f, game_type: v }))}
            />

            <Text style={styles.editTournLabel}>Proposed Date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.editTournInput}
              placeholder="2025-08-15"
              placeholderTextColor="#333"
              value={editTournForm.proposed_date}
              onChangeText={v => setEditTournForm(f => ({ ...f, proposed_date: v }))}
            />

            <Text style={styles.editTournLabel}>Max Players</Text>
            <TextInput
              style={styles.editTournInput}
              placeholder="20"
              placeholderTextColor="#333"
              keyboardType="number-pad"
              value={editTournForm.max_players}
              onChangeText={v => setEditTournForm(f => ({ ...f, max_players: v }))}
            />

            {editTournTarget?.is_individual && editTournTarget?.game_type === "Skee-Ball" && (<>
              <Text style={styles.editTournLabel}>Sign-up Opens (e.g. 7:30 PM)</Text>
              <TextInput
                style={styles.editTournInput}
                placeholder="7:30 PM"
                placeholderTextColor="#333"
                value={editTournForm.signup_time}
                onChangeText={v => setEditTournForm(f => ({ ...f, signup_time: v }))}
              />
              <Text style={styles.editTournLabel}>Tournament Starts (e.g. 8:00 PM)</Text>
              <TextInput
                style={styles.editTournInput}
                placeholder="8:00 PM"
                placeholderTextColor="#333"
                value={editTournForm.start_time}
                onChangeText={v => setEditTournForm(f => ({ ...f, start_time: v }))}
              />
            </>)}

            {tournError && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
                <Text style={styles.errorBoxText}>{tournError}</Text>
              </View>
            )}

            <View style={styles.confirmBtns}>
              <Pressable style={styles.confirmCancel} onPress={() => setEditTournTarget(null)}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.editTournSaveBtn, editingTourn && { opacity: 0.5 }]}
                onPress={handleEditTournament}
                disabled={editingTourn}
              >
                {editingTourn
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Text style={styles.editTournSaveText}>Save Changes</Text>}
              </Pressable>
            </View>
          </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Delete tournament confirm modal */}
      <Modal visible={!!deleteTournTarget} transparent animationType="fade" onRequestClose={() => setDeleteTournTarget(null)}>
        <View style={styles.confirmBg}>
          <Pressable style={styles.confirmDismiss} onPress={() => setDeleteTournTarget(null)} />
          <View style={styles.confirmSheet}>
            <View style={[styles.confirmIconWrap, { backgroundColor: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.25)" }]}>
              <Ionicons name="trophy-outline" size={36} color="#ef4444" />
            </View>
            <Text style={styles.confirmTitle}>Delete Tournament?</Text>
            <Text style={styles.confirmBody}>
              "{deleteTournTarget?.title}" will be permanently removed. This cannot be undone.
            </Text>
            <View style={styles.confirmBtns}>
              <Pressable style={styles.confirmCancel} onPress={() => setDeleteTournTarget(null)}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmActionBtn, { backgroundColor: "#ef4444" }, deletingTourn && { opacity: 0.5 }]}
                onPress={handleDeleteTournament}
                disabled={deletingTourn}
              >
                {deletingTourn
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={[styles.confirmActionText, { color: "#fff" }]}>Delete</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Bracket viewer modal ─────────────────────────────────────────── */}
      <Modal visible={!!bracketTournId} transparent animationType="slide" onRequestClose={() => setBracketTournId(null)}>
        <View style={[styles.confirmBg, { justifyContent: "flex-end", padding: 0 }]}>
          <Pressable style={styles.confirmDismiss} onPress={() => setBracketTournId(null)} />
          <View style={{ backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 1, borderColor: "#1e1e1e", height: "90%" }}>
            {/* Header */}
            <View style={styles.bracketModalHeader}>
              <Text style={styles.bracketModalTitle}>Bracket</Text>
              <Pressable onPress={() => setBracketTournId(null)}>
                <Ionicons name="close-circle" size={26} color="#444" />
              </Pressable>
            </View>

            {/* Round tabs */}
            {bracketData?.rounds && (
              <View style={styles.bracketRoundTabs}>
                {(bracketData.rounds as BracketRound[]).map(r => (
                  <Pressable
                    key={r.round_number}
                    style={[styles.bracketRoundTab, bracketRoundTab === r.round_number && styles.bracketRoundTabActive]}
                    onPress={() => setBracketRoundTab(r.round_number)}
                  >
                    <Text style={[styles.bracketRoundTabText, bracketRoundTab === r.round_number && { color: "#a855f7" }]}>
                      {r.round_name}
                    </Text>
                    <View style={[styles.bracketRoundDot, {
                      backgroundColor: r.status === "in_progress" ? "#f59e0b" : r.status === "completed" ? "#22c55e" : "#333",
                    }]} />
                  </Pressable>
                ))}
              </View>
            )}

            {bracketLoading ? (
              <ActivityIndicator color="#a855f7" style={{ marginTop: 40 }} />
            ) : (
              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
                {(() => {
                  const round = (bracketData?.rounds as BracketRound[] | null)?.find(r => r.round_number === bracketRoundTab);
                  if (!round) return <Text style={{ color: "#444", textAlign: "center", marginTop: 40 }}>Round not yet started</Text>;
                  if (!round.groups) return <Text style={{ color: "#444", textAlign: "center", marginTop: 40 }}>No groups yet</Text>;
                  return round.groups.map(g => {
                    const currentGame = (g.games ?? []).find(gm => gm.status === "pending") ?? (g.games ?? []).slice(-1)[0];
                    const activePlayers = (g.slots ?? []).filter(s => s.status === "active");
                    return (
                      <View key={g.id} style={styles.bracketGroupCard}>
                        <View style={styles.bracketGroupHeader}>
                          <Text style={styles.bracketGroupTitle}>Group {g.group_number}</Text>
                          <View style={[styles.bracketGroupStatus, {
                            backgroundColor: g.status === "completed" ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)",
                            borderColor: g.status === "completed" ? "rgba(34,197,94,0.3)" : "rgba(245,158,11,0.3)",
                          }]}>
                            <Text style={{ color: g.status === "completed" ? "#22c55e" : "#f59e0b", fontSize: 10, fontWeight: "800" }}>
                              {g.status === "completed" ? "DONE" : g.status === "game2" ? "GAME 2" : "GAME 1"}
                            </Text>
                          </View>
                        </View>
                        {(g.slots ?? []).map(s => (
                          <View key={`${s.user_id}_${s.seed}`} style={styles.bracketSlotRow}>
                            <Ionicons
                              name={s.status === "eliminated" ? "close-circle" : s.status === "advanced" ? "checkmark-circle" : "ellipse"}
                              size={14}
                              color={s.status === "eliminated" ? "#ef4444" : s.status === "advanced" ? "#22c55e" : "#555"}
                            />
                            <Text style={[styles.bracketSlotName, s.status === "eliminated" && { color: "#333", textDecorationLine: "line-through" }]}>
                              {s.username}
                            </Text>
                            {s.final_rank && <Text style={styles.bracketSlotRank}>#{s.final_rank}</Text>}
                            {s.eliminated_game && <Text style={styles.bracketSlotElim}>out g{s.eliminated_game}</Text>}
                          </View>
                        ))}
                        {/* Game results */}
                        {(g.games ?? []).filter(gm => gm.status === "completed" && gm.scores).map(gm => (
                          <View key={gm.id} style={styles.bracketGameResult}>
                            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                              <Text style={styles.bracketGameResultLabel}>Game {gm.game_number} results:</Text>
                              <Pressable
                                onPress={() => {
                                  const slots = g.slots ?? [];
                                  const init: Record<string, string> = {};
                                  (gm.scores ?? []).forEach(sc => {
                                    const slot = sc.player_seed != null
                                      ? slots.find(s => s.user_id === sc.user_id && s.seed === sc.player_seed)
                                      : (gm.game_number === 1
                                          ? slots.find(s => s.user_id === sc.user_id)
                                          : slots.find(s => s.user_id === sc.user_id && s.eliminated_game !== 1));
                                    if (slot) init[String(slot.seed)] = String(sc.score);
                                  });
                                  setGameScores(init);
                                  setTournError(null);
                                  setScoringGame({ game: gm, group: g, round, isEditing: true });
                                }}
                                style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: "rgba(245,158,11,0.08)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(245,158,11,0.2)" }}
                              >
                                <Ionicons name="pencil-outline" size={11} color="#f59e0b" />
                                <Text style={{ color: "#f59e0b", fontSize: 10, fontWeight: "800" }}>Edit</Text>
                              </Pressable>
                            </View>
                            {(gm.scores ?? []).map((sc, idx) => (
                              <Text key={`${sc.user_id}_${idx}`} style={[styles.bracketGameScore, sc.is_eliminated && { color: "#ef4444" }]}>
                                {sc.username}: {sc.score.toLocaleString()}
                                {sc.rank_points != null ? ` → ${sc.rank_points}rp` : ""}
                                {sc.is_eliminated ? " ✗" : ""}
                              </Text>
                            ))}
                          </View>
                        ))}
                        {/* Enter scores button */}
                        {g.status !== "completed" && currentGame && round.status !== "completed" && (
                          <Pressable
                            style={styles.bracketEnterScoresBtn}
                            onPress={() => {
                              const init: Record<string, string> = {};
                              activePlayers.forEach(p => { init[String(p.seed)] = ""; });
                              setGameScores(init);
                              setTournError(null);
                              setScoringGame({ game: currentGame, group: g, round, isEditing: false });
                            }}
                          >
                            <Ionicons name="create-outline" size={13} color="#a855f7" />
                            <Text style={styles.bracketEnterScoresBtnText}>Enter Game {currentGame.game_number} Scores</Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  });
                })()}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Score entry modal ────────────────────────────────────────────── */}
      <Modal visible={!!scoringGame} transparent animationType="slide" onRequestClose={() => setScoringGame(null)}>
        <View style={[styles.confirmBg, { justifyContent: "flex-end", padding: 0 }]}>
          <Pressable style={styles.confirmDismiss} onPress={() => setScoringGame(null)} />
          <View style={styles.scoreEntrySheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.scoreEntryTitle}>
              {scoringGame?.isEditing ? "Edit " : ""}{scoringGame?.round.round_name} · Group {scoringGame?.group.group_number} · Game {scoringGame?.game.game_number}
            </Text>
            <Text style={styles.scoreEntryHint}>
              {scoringGame?.isEditing
                ? "Correcting scores — previous results will be recalculated."
                : scoringGame?.round.round_number === 4
                  ? "Final 4 — 1 game. Scores determine 1st through 4th place."
                  : scoringGame?.round.round_number === 1
                    ? scoringGame?.game.game_number === 2
                      ? "3 players · Game 2. Lowest score eliminated. Top 2 advance."
                      : "4 players · Game 1. Lowest score eliminated. 3 remain for Game 2."
                    : "4 players · 1 game. Bottom 2 scores eliminated. Top 2 advance."}
            </Text>
            {scoringGame && (() => {
              const allSlots = scoringGame.group.slots ?? [];
              const slotsForModal = scoringGame.isEditing
                ? scoringGame.game.game_number === 1
                  ? allSlots
                  : allSlots.filter(s => s.eliminated_game !== 1)
                : allSlots.filter(s => s.status === "active");
              return slotsForModal;
            })().map(p => (
              <View key={String(p.seed)} style={styles.scoreEntryRow}>
                <Text style={styles.scoreEntryName}>{p.username}</Text>
                <TextInput
                  style={styles.scoreEntryInput}
                  placeholder="0"
                  placeholderTextColor="#333"
                  keyboardType="number-pad"
                  value={gameScores[String(p.seed)] ?? ""}
                  onChangeText={v => setGameScores(prev => ({ ...prev, [String(p.seed)]: v }))}
                />
                <Text style={styles.scoreEntryPts}>pts</Text>
              </View>
            ))}
            {tournError && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
                <Text style={styles.errorBoxText}>{tournError}</Text>
              </View>
            )}
            <View style={[styles.confirmBtns, { marginTop: 16 }]}>
              <Pressable style={styles.confirmCancel} onPress={() => setScoringGame(null)}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.editTournSaveBtn, submittingScores && { opacity: 0.5 }]}
                onPress={handleSubmitGameScores}
                disabled={submittingScores}
              >
                {submittingScores
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Text style={styles.editTournSaveText}>Submit Scores</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Tournament complete — top 4 announcement */}
      <Modal visible={bracketWinners !== null} transparent animationType="fade" onRequestClose={() => setBracketWinners(null)}>
        <View style={styles.confirmBg}>
          <Pressable style={styles.confirmDismiss} onPress={() => setBracketWinners(null)} />
          <View style={[styles.confirmSheet, { alignItems: "center", paddingTop: 28 }]}>
            <Text style={{ fontSize: 48, marginBottom: 8 }}>🏆</Text>
            <Text style={[styles.confirmTitle, { fontSize: 22, marginBottom: 4 }]}>Tournament Complete!</Text>
            <Text style={[styles.confirmBody, { marginBottom: 20 }]}>Final standings for this event</Text>
            {(bracketWinners ?? []).map(w => (
              <View key={w.seed} style={{ flexDirection: "row", alignItems: "center", gap: 14, width: "100%", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e1e1e" }}>
                <Text style={{ fontSize: 28, width: 40, textAlign: "center" }}>
                  {w.final_rank === 1 ? "🥇" : w.final_rank === 2 ? "🥈" : w.final_rank === 3 ? "🥉" : "4️⃣"}
                </Text>
                <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700", flex: 1 }}>{w.username}</Text>
                <Text style={{ color: "#555", fontSize: 13 }}>#{w.final_rank}</Text>
              </View>
            ))}
            <Pressable style={[styles.editTournSaveBtn, { marginTop: 20, width: "100%" }]} onPress={() => setBracketWinners(null)}>
              <Text style={styles.editTournSaveText}>Done</Text>
            </Pressable>
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

      {/* Player list manager modal */}
      <Modal visible={playerListTarget !== null} transparent animationType="slide" onRequestClose={() => setPlayerListTarget(null)}>
        <View style={[styles.confirmBg, { justifyContent: "flex-end", padding: 0 }]}>
          <Pressable style={styles.confirmDismiss} onPress={() => setPlayerListTarget(null)} />
          <View style={{ backgroundColor: "#111", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: "#1e1e1e", padding: 24, paddingBottom: Platform.OS === "ios" ? 40 : 24, maxHeight: "70%" }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <Text style={{ color: "#fff", fontSize: 18, fontWeight: "900" }}>Registered Players</Text>
              <Pressable onPress={() => setPlayerListTarget(null)}>
                <Ionicons name="close" size={22} color="#555" />
              </Pressable>
            </View>
            <Text style={{ color: "#555", fontSize: 13, marginBottom: 16 }} numberOfLines={1}>
              {playerListTarget?.title}
            </Text>

            {playerListError && (
              <Text style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{playerListError}</Text>
            )}

            {playerListLoading ? (
              <ActivityIndicator color="#06b6d4" style={{ marginVertical: 24 }} />
            ) : playerList.length === 0 ? (
              <Text style={{ color: "#444", fontSize: 14, textAlign: "center", paddingVertical: 24 }}>No players registered yet.</Text>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {playerList.map(p => (
                  <View key={p.id} style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#0d0d0d", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 6, borderWidth: 1, borderColor: "#1e1e1e" }}>
                    <Ionicons
                      name={p.guest_name ? "person-outline" : "person"}
                      size={14}
                      color={p.guest_name ? "#22c55e" : "#06b6d4"}
                    />
                    <Text style={{ flex: 1, color: "#ccc", fontSize: 14, fontWeight: "700", marginLeft: 8 }}>
                      {p.username}
                      {p.guest_name ? <Text style={{ color: "#22c55e", fontWeight: "400" }}> (guest)</Text> : null}
                    </Text>
                    <View style={{ backgroundColor: p.status === "accepted" ? "rgba(34,197,94,0.12)" : "rgba(85,85,85,0.12)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginRight: 8 }}>
                      <Text style={{ color: p.status === "accepted" ? "#22c55e" : "#555", fontSize: 11, fontWeight: "700" }}>
                        {p.status}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => handleRemovePlayer(p.id)}
                      disabled={removingPlayer === p.id}
                      hitSlop={8}
                    >
                      {removingPlayer === p.id
                        ? <ActivityIndicator size="small" color="#ef4444" />
                        : <Ionicons name="close-circle" size={20} color="#ef4444" />
                      }
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Guest player manager modal */}
      <Modal visible={guestTargetId !== null} transparent animationType="slide" onRequestClose={() => setGuestTargetId(null)}>
        <View style={[styles.confirmBg, { justifyContent: "flex-end", padding: 0 }]}>
          <Pressable style={styles.confirmDismiss} onPress={() => setGuestTargetId(null)} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={{ backgroundColor: "#111", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: "#1e1e1e", padding: 24, paddingBottom: Platform.OS === "ios" ? 40 : 24 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <Text style={{ color: "#fff", fontSize: 18, fontWeight: "900" }}>Add Guest Players</Text>
                <Pressable onPress={() => setGuestTargetId(null)}>
                  <Ionicons name="close" size={22} color="#555" />
                </Pressable>
              </View>
              <Text style={{ color: "#555", fontSize: 13, marginBottom: 20 }}>Players without accounts can join by name only.</Text>

              {/* Current guest list */}
              {guestListLoading ? (
                <ActivityIndicator color="#22c55e" style={{ marginBottom: 16 }} />
              ) : guestList.length > 0 ? (
                <View style={{ marginBottom: 16 }}>
                  {guestList.map(g => (
                    <View key={g.id} style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#0d0d0d", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 6, borderWidth: 1, borderColor: "#1e1e1e" }}>
                      <Ionicons name="person-outline" size={14} color="#22c55e" />
                      <Text style={{ flex: 1, color: "#ccc", fontSize: 14, fontWeight: "700", marginLeft: 8 }}>{g.guest_name}</Text>
                      <Pressable onPress={() => handleRemoveGuest(g.id)} hitSlop={8}>
                        <Ionicons name="close-circle" size={18} color="#333" />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}

              {/* Add new guest */}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TextInput
                  style={[styles.textInput, { flex: 1, backgroundColor: "#0a0a0a" }]}
                  placeholder="Guest name"
                  placeholderTextColor="#333"
                  value={guestName}
                  onChangeText={setGuestName}
                  maxLength={40}
                  returnKeyType="done"
                  onSubmitEditing={handleAddGuest}
                />
                <Pressable
                  style={[styles.confirmActionBtn, { backgroundColor: "#22c55e", paddingHorizontal: 18, opacity: (!guestName.trim() || addingGuest) ? 0.5 : 1 }]}
                  onPress={handleAddGuest}
                  disabled={!guestName.trim() || addingGuest}
                >
                  {addingGuest ? <ActivityIndicator size="small" color="#000" /> : <Text style={[styles.confirmActionText, { color: "#000" }]}>Add</Text>}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
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

function ScoreCard({ item, tab, actioning, proofLoading, onApprove, onDeny, onRevoke, onReApprove, onPhotoPress }: {
  item: ReviewScore; tab: ReviewTab; actioning: boolean; proofLoading: boolean;
  onApprove: () => void; onDeny: () => void; onRevoke: () => void; onReApprove: () => void; onPhotoPress: () => void;
}) {
  const hasProof = !!(item.proof_storage_path || item.photo_url);
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

      {hasProof ? (
        <Pressable style={styles.photoWrap} onPress={onPhotoPress} disabled={proofLoading}>
          {item.photo_url
            ? <Image source={{ uri: item.photo_url }} style={styles.photoThumb} contentFit="cover" cachePolicy="none" />
            : <View style={[styles.photoThumb, { backgroundColor: "#111", alignItems: "center", justifyContent: "center" }]}>
                <Ionicons name="image-outline" size={28} color="#333" />
              </View>}
          <View style={styles.photoTapHint}>
            {proofLoading
              ? <ActivityIndicator size="small" color="#fff" />
              : <><Ionicons name="expand-outline" size={14} color="#fff" /><Text style={styles.photoTapText}>Tap to view</Text></>}
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

  // Main tabs (Reviews / Stats / Health / …)
  mainTabBarWrap: { position: "relative" },
  mainTabBar: {
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  mainTabBarContent: {
    flexDirection: "row", paddingHorizontal: 8,
  },
  mainTabFadeRight: {
    position: "absolute", right: 0, top: 0, bottom: 0, width: 32,
    // Simulates a right-edge fade by overlaying a semi-transparent dark band
    backgroundColor: "rgba(8,8,8,0.6)",
    pointerEvents: "none",
  } as any,
  mainTabItem: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 13, paddingHorizontal: 12,
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
  manageTournCard: { backgroundColor: "#111", borderRadius: 16, borderWidth: 1, borderColor: "#1e1e1e", padding: 14, marginBottom: 10 },
  manageTournInnerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
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

  // First Friday QR section
  ffQrSection: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1e1e1e", paddingTop: 12 },
  ffQrHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  ffQrLabel: { color: "#555", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, flex: 1 },
  ffQrCount: { color: "#444", fontSize: 12, fontWeight: "600" },
  ffQrStatusChip: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1 },
  ffQrDot: { width: 6, height: 6, borderRadius: 3 },
  ffQrStatusText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  ffQrImageWrap: { alignItems: "center", marginBottom: 12 },
  ffQrImage: { width: 180, height: 180, borderRadius: 12 },
  ffQrHint: { color: "#444", fontSize: 11, marginTop: 6 },
  ffQrBtnRow: { flexDirection: "row", gap: 8 },
  ffGenerateBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#06b6d4", borderRadius: 12, paddingVertical: 10 },
  ffGenerateBtnText: { color: "#000", fontWeight: "800", fontSize: 13 },
  ffRevokeBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.06)" },
  ffRevokeBtnText: { color: "#ef4444", fontWeight: "800", fontSize: 13 },

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
  userCardName: { color: "#fff", fontSize: 14, fontWeight: "800", marginBottom: 2 },
  userCardEmail: { color: "#555", fontSize: 11, marginBottom: 4 },
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
  modFlagBadge: {
    flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5,
    backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start",
    borderWidth: 1, borderColor: "rgba(245,158,11,0.3)",
  },
  modFlagText: { color: "#f59e0b", fontSize: 11, fontWeight: "700" },

  // Support inbox
  tabUnreadDot: {
    position: "absolute", top: -2, right: -4,
    width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#06b6d4",
  },
  suppTicketCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#111", borderRadius: 16, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: "#1e1e1e",
  },
  suppTicketAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "rgba(6,182,212,0.1)", borderWidth: 1,
    borderColor: "rgba(6,182,212,0.2)", alignItems: "center", justifyContent: "center",
  },
  suppTicketUser: { color: "#fff", fontSize: 14, fontWeight: "800", marginBottom: 2 },
  suppTicketTime: { color: "#444", fontSize: 12 },

  suppConvHeader: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  suppBackBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "#111", alignItems: "center", justifyContent: "center",
  },
  suppConvUser: { color: "#fff", fontSize: 14, fontWeight: "800" },
  suppConvSub:  { color: "#444", fontSize: 11, marginTop: 1 },
  suppResolveBtn: {
    backgroundColor: "rgba(34,197,94,0.12)", borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: "rgba(34,197,94,0.3)",
  },
  suppResolveBtnText: { color: "#22c55e", fontSize: 12, fontWeight: "800" },

  suppMsgList: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 },
  suppMsgRow:      { marginBottom: 8, maxWidth: "80%" },
  suppMsgRowUser:  { alignSelf: "flex-start" },
  suppMsgRowAdmin: { alignSelf: "flex-end" },
  suppBubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  suppBubbleUser:  { backgroundColor: "#1a1a1a", borderBottomLeftRadius: 4 },
  suppBubbleAdmin: { backgroundColor: "#06b6d4", borderBottomRightRadius: 4 },
  suppAdminLabel: { color: "rgba(0,0,0,0.6)", fontSize: 10, fontWeight: "800", marginBottom: 3 },
  suppBubbleText: { fontSize: 14, lineHeight: 20 },
  suppBubbleTextUser:  { color: "#e0e0e0" },
  suppBubbleTextAdmin: { color: "#000" },
  suppBubbleTime: { fontSize: 10, marginTop: 4 },
  suppTimeUser:  { color: "#444" },
  suppTimeAdmin: { color: "rgba(0,0,0,0.45)", textAlign: "right" },

  suppReplyRow: {
    flexDirection: "row", alignItems: "flex-end", gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a",
    backgroundColor: "#000",
  },
  suppReplyInput: {
    flex: 1, backgroundColor: "#111", borderRadius: 20,
    borderWidth: 1, borderColor: "#1e1e1e",
    color: "#fff", fontSize: 14, paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 10 : 7, maxHeight: 100,
  },
  suppSendBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
  },
  suppSendBtnOff: { backgroundColor: "#0a4a55", opacity: 0.5 },

  manageTournIconBtn: {
    width: 30, height: 30, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(136,136,136,0.25)",
    backgroundColor: "rgba(136,136,136,0.06)",
  },

  editTournSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40,
    borderTopWidth: 1, borderColor: "#1e1e1e",
  },
  editTournTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  editTournSub:   { color: "#555", fontSize: 13, marginBottom: 20 },
  textInput: { backgroundColor: "#111", borderRadius: 12, borderWidth: 1, borderColor: "#1e1e1e", color: "#fff", fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  editTournLabel: { color: "#888", fontSize: 12, fontWeight: "700", marginBottom: 6, marginTop: 12 },
  editTournInput: {
    backgroundColor: "#0a0a0a", borderRadius: 12,
    borderWidth: 1, borderColor: "#1e1e1e",
    color: "#fff", fontSize: 15,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  editTournSaveBtn: {
    flex: 1, backgroundColor: "#06b6d4", borderRadius: 14,
    paddingVertical: 14, alignItems: "center", justifyContent: "center",
  },
  editTournSaveText: { color: "#000", fontWeight: "900", fontSize: 15 },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 10,
    padding: 10, marginTop: 12,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
  },
  errorBoxText: { color: "#ef4444", fontSize: 12, flex: 1 },

  // ── First Friday times & bracket UI ─────────────────────────────────────────
  ffTimesRow: {
    flexDirection: "row", alignItems: "center", gap: 16,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: "rgba(6,182,212,0.06)",
    borderRadius: 10, marginBottom: 8,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.12)",
  },
  ffTimesText: { color: "#06b6d4", fontSize: 12, fontWeight: "700" },

  ffBracketSection: {
    marginTop: 8, paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: "rgba(168,85,247,0.06)",
    borderRadius: 10, borderWidth: 1, borderColor: "rgba(168,85,247,0.12)",
  },
  ffBracketHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  ffBracketLabel: { color: "#a855f7", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  ffBracketCount: { color: "#fff", fontSize: 13, fontWeight: "700" },
  ffBracketHint:  { color: "#666", fontSize: 11, marginBottom: 8 },
  ffAddGuestBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(34,197,94,0.07)", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: "rgba(34,197,94,0.2)", marginBottom: 8 },
  ffAddGuestBtnText: { color: "#22c55e", fontSize: 12, fontWeight: "700" },

  manageTournPlayersBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(6,182,212,0.07)", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: "rgba(6,182,212,0.2)", marginTop: 10, marginBottom: 2 },
  manageTournPlayersBtnText: { flex: 1, color: "#06b6d4", fontSize: 12, fontWeight: "700" },

  ffBracketGenBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#a855f7", borderRadius: 10,
    paddingVertical: 9, paddingHorizontal: 16,
  },
  ffBracketGenBtnText: { color: "#fff", fontWeight: "900", fontSize: 13 },

  ffBracketOpenBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "rgba(168,85,247,0.15)", borderRadius: 10,
    paddingVertical: 9, paddingHorizontal: 16,
    borderWidth: 1, borderColor: "rgba(168,85,247,0.3)",
  },
  ffBracketOpenBtnText: { color: "#a855f7", fontWeight: "900", fontSize: 13 },

  // Bracket viewer modal
  bracketModalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e1e1e",
  },
  bracketModalTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },

  bracketRoundTabs: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  bracketRoundTab: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: "#222",
    backgroundColor: "#111",
  },
  bracketRoundTabActive: { backgroundColor: "#a855f7", borderColor: "#a855f7" },
  bracketRoundTabText: { color: "#888", fontSize: 12, fontWeight: "700" },
  bracketRoundDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: "#22c55e",
  },

  bracketGroupCard: {
    marginHorizontal: 16, marginBottom: 14,
    backgroundColor: "#111", borderRadius: 14,
    borderWidth: 1, borderColor: "#1e1e1e",
    overflow: "hidden",
  },
  bracketGroupHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: "rgba(168,85,247,0.08)",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e1e1e",
  },
  bracketGroupTitle: { color: "#a855f7", fontSize: 13, fontWeight: "900" },
  bracketGroupStatus: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, borderWidth: 1,
  },

  bracketSlotRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#141414",
  },
  bracketSlotName: { flex: 1, color: "#ccc", fontSize: 13 },
  bracketSlotRank: { color: "#f59e0b", fontSize: 12, fontWeight: "700", marginRight: 8 },
  bracketSlotElim: { color: "#ef4444", fontSize: 11, fontStyle: "italic" },

  bracketGameResult: {
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: "rgba(6,182,212,0.04)",
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a",
  },
  bracketGameResultLabel: { color: "#06b6d4", fontSize: 11, fontWeight: "700", marginBottom: 4 },
  bracketGameScore: { color: "#888", fontSize: 12 },

  bracketEnterScoresBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    margin: 14, marginTop: 8,
    backgroundColor: "#06b6d4", borderRadius: 10,
    paddingVertical: 10,
  },
  bracketEnterScoresBtnText: { color: "#000", fontWeight: "900", fontSize: 13 },

  // Score entry sheet
  scoreEntrySheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40,
    borderTopWidth: 1, borderColor: "#1e1e1e",
  },
  scoreEntryTitle: { color: "#fff", fontSize: 18, fontWeight: "900", marginBottom: 4 },
  scoreEntryHint:  { color: "#555", fontSize: 12, marginBottom: 16 },
  scoreEntryRow: {
    flexDirection: "row", alignItems: "center",
    marginBottom: 10, gap: 10,
  },
  scoreEntryName: { flex: 1, color: "#ccc", fontSize: 14 },
  scoreEntryInput: {
    width: 90, backgroundColor: "#0a0a0a", borderRadius: 10,
    borderWidth: 1, borderColor: "#1e1e1e",
    color: "#fff", fontSize: 15,
    paddingHorizontal: 12, paddingVertical: 9,
    textAlign: "center",
  },
  scoreEntryPts: { color: "#444", fontSize: 12, width: 24 },

  // ── Karaoke ──────────────────────────────────────────────────────────────
  karaokeToolbar: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  karaokeQueueCount: { color: "#555", fontSize: 13, fontWeight: "700" },
  karaokeHistoryBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#0d0d0d", borderWidth: 1, borderColor: "#1e1e1e" },
  karaokeHistoryBtnText: { color: "#555", fontSize: 12, fontWeight: "700" },

  karaokeNowCard: { backgroundColor: "#111", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "rgba(168,85,247,0.3)", marginBottom: 20 },
  karaokeNowBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#a855f7", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start", marginBottom: 12 },
  karaokeNowBadgeText: { color: "#000", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  karaokeNowRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  karaokeNowThumb: { width: 68, height: 50, borderRadius: 8 },
  karaokeThumbPlaceholder: { backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center" },
  karaokeNowTitle: { color: "#fff", fontSize: 14, fontWeight: "800", marginBottom: 3 },
  karaokeNowChannel: { color: "#555", fontSize: 12, marginBottom: 2 },
  karaokeNowRequester: { color: "#a855f7", fontSize: 12, fontWeight: "700", marginBottom: 6 },
  karaokeYtLink: { flexDirection: "row", alignItems: "center", gap: 4 },
  karaokeYtLinkText: { color: "#ef4444", fontSize: 11, fontWeight: "700" },
  karaokeSkipBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#ef4444", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start" },
  karaokeSkipBtnText: { color: "#fff", fontSize: 12, fontWeight: "900" },

  karaokeQueueItem: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#111", borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#1e1e1e" },
  karaokeQueuePos: { color: "#555", fontSize: 12, fontWeight: "900", minWidth: 18, textAlign: "center" },
  karaokeQueueThumb: { width: 48, height: 34, borderRadius: 6 },
  karaokeQueueInfo: { flex: 1 },
  karaokeQueueTitle: { color: "#fff", fontSize: 13, fontWeight: "700", marginBottom: 2 },
  karaokeQueueMeta: { color: "#555", fontSize: 11, marginBottom: 4 },
  karaokeRemoveBtn: { padding: 2 },

  karaokeHistoryToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a", marginTop: 8 },
  karaokeHistoryToggleText: { color: "#555", fontSize: 13, fontWeight: "700" },

  // ── Trivia ───────────────────────────────────────────────────────────────────
  triviaTabRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  triviaTabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#1e1e1e", backgroundColor: "#0d0d0d" },
  triviaTabBtnActive: { borderColor: "rgba(6,182,212,0.4)", backgroundColor: "rgba(6,182,212,0.07)" },
  triviaTabBtnText: { color: "#555", fontWeight: "800", fontSize: 13 },

  triviaCreateBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 16, borderWidth: 1, borderColor: "rgba(6,182,212,0.3)", backgroundColor: "rgba(6,182,212,0.06)", marginBottom: 12 },
  triviaCreateBtnText: { color: "#06b6d4", fontWeight: "800", fontSize: 14 },

  triviaFormCard: { backgroundColor: "#111", borderRadius: 18, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#1e1e1e" },
  triviaFormTitle: { color: "#fff", fontSize: 15, fontWeight: "900", marginBottom: 12 },
  triviaFormLabel: { color: "#555", fontSize: 12, fontWeight: "700", marginBottom: 5, marginTop: 10 },
  triviaFormInput: { backgroundColor: "#0a0a0a", borderRadius: 10, borderWidth: 1, borderColor: "#1e1e1e", color: "#fff", fontSize: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 2 },
  triviaFormRow: { flexDirection: "row", gap: 10 },

  triviaToggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, marginBottom: 4 },
  triviaToggle: { width: 44, height: 26, borderRadius: 13, backgroundColor: "#1a1a1a", justifyContent: "center", paddingHorizontal: 3, borderWidth: 1, borderColor: "#2a2a2a" },
  triviaToggleOn: { backgroundColor: "rgba(6,182,212,0.2)", borderColor: "rgba(6,182,212,0.4)" },
  triviaToggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#333" },
  triviaToggleThumbOn: { backgroundColor: "#06b6d4", alignSelf: "flex-end" },

  triviaTypeRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  triviaTypeBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: "#1e1e1e", backgroundColor: "#0d0d0d" },
  triviaTypeBtnActive: { borderColor: "rgba(6,182,212,0.4)", backgroundColor: "rgba(6,182,212,0.07)" },
  triviaTypeBtnText: { color: "#555", fontWeight: "700", fontSize: 13 },

  triviaOptRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  triviaOptLetter: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#2a2a2a" },
  triviaOptLetterCorrect: { backgroundColor: "#22c55e", borderColor: "#22c55e" },
  triviaOptLetterText: { color: "#555", fontWeight: "900", fontSize: 13 },

  triviaQPickRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#0a0a0a", borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: "#1a1a1a" },
  triviaQPickRowSelected: { borderColor: "rgba(6,182,212,0.4)", backgroundColor: "rgba(6,182,212,0.05)" },
  triviaCheckbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: "#2a2a2a", alignItems: "center", justifyContent: "center" },
  triviaCheckboxChecked: { backgroundColor: "#06b6d4", borderColor: "#06b6d4" },
  triviaQPickText: { flex: 1, color: "#888", fontSize: 12 },
  triviaQPickType: { color: "#444", fontSize: 10, fontWeight: "700" },

  triviaSaveBtn: { backgroundColor: "#06b6d4", borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 12 },
  triviaSaveBtnText: { color: "#000", fontWeight: "900", fontSize: 14 },
  triviaDiscardBtn: { borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 12, borderWidth: 1, borderColor: "#1e1e1e", paddingHorizontal: 16 },
  triviaDiscardBtnText: { color: "#555", fontWeight: "700", fontSize: 14 },
  triviaEmpty: { color: "#444", fontSize: 13, textAlign: "center", paddingVertical: 16 },

  triviaGameCard: { backgroundColor: "#111", borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#1e1e1e" },
  triviaGameCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  triviaGameTitle: { color: "#fff", fontSize: 15, fontWeight: "900" },
  triviaGameMeta: { color: "#555", fontSize: 12, marginTop: 3 },
  triviaStatusBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  triviaStatusText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  triviaQrRow: { marginBottom: 10 },
  triviaQrBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12, borderWidth: 1, borderColor: "rgba(6,182,212,0.3)", backgroundColor: "rgba(6,182,212,0.07)" },
  triviaQrBtnText: { color: "#06b6d4", fontSize: 12, fontWeight: "800" },
  triviaPlayersToggle: {
    flexDirection: "row", alignItems: "center", gap: 7,
    paddingVertical: 9, paddingHorizontal: 2, marginBottom: 2,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1e1e1e",
  },
  triviaPlayersToggleText: { flex: 1, color: "#666", fontSize: 12, fontWeight: "700" },
  triviaPlayersList: {
    backgroundColor: "#0a0a0a", borderRadius: 12,
    borderWidth: 1, borderColor: "#1a1a1a", marginBottom: 10, overflow: "hidden",
  },
  triviaPlayersEmpty: { color: "#444", fontSize: 12, textAlign: "center", paddingVertical: 14 },
  triviaPlayerRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  triviaPlayerAvatar: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: "#1a1a1a", borderWidth: 1, borderColor: "#2a2a2a",
    alignItems: "center", justifyContent: "center",
  },
  triviaPlayerAvatarText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  triviaPlayerName: { color: "#fff", fontSize: 13, fontWeight: "700" },
  triviaPlayerMeta: { color: "#555", fontSize: 11, marginTop: 1 },
  triviaKickBtn: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: "rgba(239,68,68,0.08)", borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
    alignItems: "center", justifyContent: "center",
  },

  triviaGameActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  triviaActionBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1 },
  triviaActionBtnText: { fontSize: 12, fontWeight: "800" },

  triviaQCard: { backgroundColor: "#111", borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#1e1e1e" },
  triviaQCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  triviaQCategory: { color: "#a855f7", fontSize: 10, fontWeight: "800", marginBottom: 3 },
  triviaQText: { color: "#fff", fontSize: 13, fontWeight: "700", lineHeight: 19, marginBottom: 4 },
  triviaQMeta: { color: "#444", fontSize: 11 },
  triviaQActions: { flexDirection: "row", gap: 14, paddingTop: 2 },
  triviaQOpts: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 10 },
  triviaQOpt: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "#0d0d0d", borderWidth: 1, borderColor: "#1a1a1a" },
  triviaQOptCorrect: { borderColor: "rgba(34,197,94,0.4)", backgroundColor: "rgba(34,197,94,0.07)" },
  triviaQOptText: { color: "#555", fontSize: 11, fontWeight: "700" },
});
