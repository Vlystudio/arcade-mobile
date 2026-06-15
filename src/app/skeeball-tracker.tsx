import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Alert } from "../../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/avatar";
import { supabase } from "../../lib/supabase";
import { showToast } from "../components/toast";
import { PressableScale } from "../components/pressable-scale";
import { ScoreText } from "../components/score-text";
import { useRequireAuth } from "../hooks/use-require-auth";
import { reportError } from "../lib/report-error";
import { fetchPlayerStats } from "../lib/skeeball-stats";
import { API_BASE } from "../../lib/api-base";

const LANE_COUNT = 6;
const TOTAL_BALLS = 9;
const BALLS_PER_ROUND = 3;
const TOTAL_ROUNDS = 3;
const PLAYERS_PER_GAME = 3;

// Round r → player[r % n]. 1p: 9 balls · 2p: P0=6,P1=3 · 3p: 3 each
function getExpectedBallsForPlayer(playerIdx: number, totalPlayers: number): number {
  let count = 0;
  for (let r = 0; r < TOTAL_ROUNDS; r++) {
    if (r % totalPlayers === playerIdx) count += BALLS_PER_ROUND;
  }
  return count;
}
const MIN_PLAYERS = 1;
const INACTIVITY_WARNING_MS  = 8 * 60 * 1000;
const INACTIVITY_TIMEOUT_MS  = 10 * 60 * 1000;
const INACTIVITY_CHECK_MS    = 30 * 1000;
const WARNING_DURATION_S     = 120;

const SKEE_RINGS = [10, 20, 30, 40, 50, 100];
const RING_COLORS: Record<number, string> = {
  10: "#555", 20: "#555", 30: "#3b82f6", 40: "#8b5cf6", 50: "#22c55e", 100: "#06b6d4",
};

type LaneSession = { id: string; team_id: string; lane_number: number; status: string; team_name?: string; last_activity_at?: string; league_match_id?: string | null; placement?: number | null; league_points?: number | null };
type SessionPlayer = { session_id: string; player_user_id: string; username: string; avatar_url: string | null; shoot_position: number | null };
type BallScore = { id: string; session_id: string; player_user_id: string; ball_number: number; score: number };
type Member = { user_id: string; username: string; avatar_url: string | null; role: string };
type SkeeballTrackerProps = {
  initialTeamId?: string;
  initialTeamName?: string;
  initialSessionId?: string;
  initialLaneToken?: string;
  initialFromQr?: boolean;
  onBack?: () => void;
};

function isMonday() {
  return new Date().getDay() === 1;
}

function getMondayDate() {
  const d = new Date();
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  return m.toISOString().split("T")[0];
}

export default function SkeeballTrackerScreen({
  initialTeamId,
  initialTeamName,
  initialSessionId,
  initialLaneToken,
  initialFromQr,
  onBack,
}: SkeeballTrackerProps = {}) {
  const { teamId: routeTeamId, teamName: routeTeamName, sessionId, laneToken, fromQr } = useLocalSearchParams<{
    teamId?: string;
    teamName?: string;
    sessionId?: string;
    laneToken?: string;
    fromQr?: string;
  }>();
  const teamId = initialTeamId ?? routeTeamId;
  const teamName = initialTeamName ?? routeTeamName;
  const { user } = useRequireAuth();

  const [loading, setLoading] = useState(true);
  const [allActiveSessions, setAllActiveSessions] = useState<LaneSession[]>([]);
  const [mySession, setMySession] = useState<LaneSession | null>(null);
  const [sessionPlayers, setSessionPlayers] = useState<SessionPlayer[]>([]);
  const [ballScores, setBallScores] = useState<BallScore[]>([]);
  const [teamMembers, setTeamMembers] = useState<Member[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Setup state
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [selectedLane, setSelectedLane] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  // Scoring state — keyed by player_user_id, value is array of ring scores tapped so far
  const [playerBalls, setPlayerBalls] = useState<Record<string, number[]>>({});
  const [isHundoWeek, setIsHundoWeek] = useState(false);

  // Week 7 = Hundo Week: only 100-ring balls decide the round winner.
  useEffect(() => {
    supabase.rpc("rpc_skeeball_week_scoring_mode").then(({ data }) => {
      setIsHundoWeek(!!(data as any)?.is_hundo_week);
    });
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  // Career best BEFORE this game, for the new-PB celebration
  const [myPrevBest, setMyPrevBest] = useState<number | null>(null);

  // Inactivity warning
  const [showWarning, setShowWarning] = useState(false);
  const [warningCountdown, setWarningCountdown] = useState(WARNING_DURATION_S);

  const channelRef = useRef<any>(null);

  const iAmPlayer = sessionPlayers.some((p) => p.player_user_id === user?.id);
  const allBallsSubmitted = sessionPlayers.length > 0 && sessionPlayers.every(
    (sp, i) => ballScores.filter((b) => b.player_user_id === sp.player_user_id).length >= getExpectedBallsForPlayer(i, sessionPlayers.length)
  );
  const sessionDone = mySession?.status === "completed";
  const takenLanes = new Set(allActiveSessions.map((s) => s.lane_number));
  const qrSessionId = initialSessionId ?? (typeof sessionId === "string" ? sessionId : undefined);
  const qrLaneToken = initialLaneToken ?? (typeof laneToken === "string" ? laneToken : undefined);
  const cameFromQr = initialFromQr === true || fromQr === "1" || !!qrSessionId || !!qrLaneToken;

  const playerProgress = sessionPlayers.map((sp, i) => ({
    ...sp,
    balls: ballScores.filter((b) => b.player_user_id === sp.player_user_id).length,
    expectedBalls: getExpectedBallsForPlayer(i, sessionPlayers.length),
  }));

  useEffect(() => {
    if (user && teamId) loadData();
  }, [user, teamId, qrSessionId, qrLaneToken]);

  useEffect(() => {
    return () => { channelRef.current?.unsubscribe(); };
  }, []);

  // Subscribe to global session changes for lane availability
  useEffect(() => {
    const ch = supabase
      .channel("skeeball_all_lane_updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "skeeball_sessions" }, async () => {
        const { data } = await supabase
          .from("skeeball_sessions")
          .select("id, team_id, lane_number, status, teams(name)")
          .eq("status", "active");

        const sessions: LaneSession[] = (data ?? []).map((s: any) => ({
          id: s.id, team_id: s.team_id, lane_number: s.lane_number, status: s.status,
          team_name: Array.isArray(s.teams) ? s.teams[0]?.name : s.teams?.name,
          last_activity_at: s.last_activity_at,
        }));
        setAllActiveSessions(sessions);

        const mine = sessions.find((s) => qrSessionId && s.id === qrSessionId) ?? sessions.find((s) => s.team_id === teamId);
        if (mine && !mySession) {
          setMySession(mine);
          await loadSessionData(mine.id);
        }
      })
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [teamId, mySession, qrSessionId]);

  // Inactivity check — every 30s, show warning at 8 min, abandon at 10 min
  useEffect(() => {
    const interval = setInterval(async () => {
      const now = Date.now();

      if (mySession?.status === "active" && mySession.last_activity_at) {
        const idle = now - new Date(mySession.last_activity_at).getTime();
        if (idle >= INACTIVITY_TIMEOUT_MS) {
          setShowWarning(false);
          await abandonSession(mySession.id);
          return;
        }
        if (idle >= INACTIVITY_WARNING_MS && !showWarning) {
          const secondsLeft = Math.ceil((INACTIVITY_TIMEOUT_MS - idle) / 1000);
          setWarningCountdown(Math.min(secondsLeft, WARNING_DURATION_S));
          setShowWarning(true);
        }
      }

      // Clean up other disconnected teams' stale sessions
      for (const s of allActiveSessions) {
        if (s.team_id === teamId || !s.last_activity_at) continue;
        const idle = now - new Date(s.last_activity_at).getTime();
        if (idle >= INACTIVITY_TIMEOUT_MS) {
          await supabase.from("skeeball_sessions").update({ status: "abandoned" }).eq("id", s.id).eq("status", "active");
        }
      }
    }, INACTIVITY_CHECK_MS);

    return () => clearInterval(interval);
  }, [mySession, allActiveSessions, teamId, showWarning]);

  // Countdown ticker — ticks every second while warning is visible
  useEffect(() => {
    if (!showWarning) return;
    if (warningCountdown <= 0) {
      setShowWarning(false);
      if (mySession) abandonSession(mySession.id);
      return;
    }
    const t = setTimeout(() => setWarningCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [showWarning, warningCountdown]);

  // Auto-complete when all balls submitted (works for 1–3 players)
  useEffect(() => {
    if (!mySession || mySession.status !== "active" || sessionPlayers.length === 0) return;
    const allIn = sessionPlayers.every(
      (sp, i) => ballScores.filter((b) => b.player_user_id === sp.player_user_id).length >= getExpectedBallsForPlayer(i, sessionPlayers.length)
    );
    if (allIn) completeSession();
  }, [ballScores, sessionPlayers, mySession]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [sessRes, memRes, profileRes] = await Promise.all([
        supabase.from("skeeball_sessions").select("id, team_id, lane_number, status, last_activity_at, league_match_id, placement, league_points, teams(name)").eq("status", "active"),
        supabase.from("team_members").select("user_id, role, profiles(username, avatar_url)").eq("team_id", teamId),
        supabase.from("profiles").select("is_admin").eq("id", user!.id).single(),
      ]);
      setIsAdmin(profileRes.data?.is_admin === true);

      const sessions: LaneSession[] = (sessRes.data ?? []).map((s: any) => ({
        id: s.id, team_id: s.team_id, lane_number: s.lane_number, status: s.status,
        team_name: Array.isArray(s.teams) ? s.teams[0]?.name : s.teams?.name,
        last_activity_at: s.last_activity_at,
        league_match_id: s.league_match_id, placement: s.placement, league_points: s.league_points,
      }));
      setAllActiveSessions(sessions);

      const members: Member[] = (memRes.data ?? []).map((m: any) => {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
        return { user_id: m.user_id, role: m.role, username: p?.username ?? "Unknown", avatar_url: p?.avatar_url ?? null };
      });
      setTeamMembers(members);
      // Pre-select all members (up to 3) so the user just needs to pick a lane
      setSelectedPlayers(members.slice(0, PLAYERS_PER_GAME).map((m) => m.user_id));

      let mine = sessions.find((s) => qrSessionId && s.id === qrSessionId) ?? sessions.find((s) => s.team_id === teamId) ?? null;

      if (!mine && qrLaneToken && teamId) {
        const session = await startQrSession(qrLaneToken, teamId);
        if (session) {
          mine = session;
          setAllActiveSessions((prev) => [
            ...prev.filter((s) => s.id !== session.id),
            session,
          ]);
        }
      }

      setMySession(mine);

      // Snapshot career best while the game is still active (PB celebration)
      if (mine && mine.status === "active" && user) {
        fetchPlayerStats(user.id).then((st) => setMyPrevBest(st?.totals.best ?? null));
      }

      if (mine) await loadSessionData(mine.id, members);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load";
      reportError("SkeeballTracker.loadData", msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function startQrSession(token: string, checkInTeamId: string): Promise<LaneSession | null> {
    const rpc = supabase.rpc("rpc_skeeball_start_qr_session", {
      p_token: token,
      p_team_id: checkInTeamId,
    });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Lane check-in timed out. Try scanning again or ask staff to refresh the QR code.")), 15000);
    });

    const { data, error } = await Promise.race([rpc, timeout]);
    if (error) throw error;

    const result = data as {
      ok?: boolean;
      error?: string;
      message?: string;
      session_id?: string;
      lane_number?: number;
      team_id?: string;
      team_name?: string;
      league_match_id?: string | null;
      already_active?: boolean;
      lane_mismatch?: boolean;
    };

    if (!result?.ok || !result.session_id) {
      throw new Error(result?.message ?? "Could not check in to this lane.");
    }

    // Scanned a different lane while already checked in elsewhere — explain it.
    if (result.already_active && result.lane_mismatch && result.message) {
      showToast(result.message, "info");
    }

    return {
      id: result.session_id,
      team_id: result.team_id ?? checkInTeamId,
      lane_number: result.lane_number ?? 0,
      status: "active",
      team_name: result.team_name ?? teamName ?? "Team",
      league_match_id: result.league_match_id ?? null,
      last_activity_at: new Date().toISOString(),
    };
  }

  async function loadSessionData(sessionId: string, members?: Member[]) {
    const mems = members ?? teamMembers;
    const [playersRes, scoresRes] = await Promise.all([
      supabase.from("skeeball_session_players").select("session_id, player_user_id, shoot_position").eq("session_id", sessionId),
      supabase.from("skeeball_ball_scores").select("*").eq("session_id", sessionId),
    ]);

    const players: SessionPlayer[] = (playersRes.data ?? [])
      .map((p: any) => {
        const m = mems.find((x) => x.user_id === p.player_user_id);
        return { ...p, shoot_position: p.shoot_position ?? null, username: m?.username ?? "Unknown", avatar_url: m?.avatar_url ?? null };
      })
      .sort((a: SessionPlayer, b: SessionPlayer) => (a.shoot_position ?? 99) - (b.shoot_position ?? 99));
    setSessionPlayers(players);
    const scores: BallScore[] = scoresRes.data ?? [];
    setBallScores(scores);

    const initialBalls: Record<string, number[]> = {};
    for (const sp of players) {
      initialBalls[sp.player_user_id] = scores
        .filter((b) => b.player_user_id === sp.player_user_id)
        .sort((a, b) => a.ball_number - b.ball_number)
        .map((b) => b.score);
    }
    setPlayerBalls(initialBalls);
    // Realtime for this session's ball scores
    if (channelRef.current) channelRef.current.unsubscribe();
    channelRef.current = supabase
      .channel(`skeeball_session_${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "skeeball_sessions", filter: `id=eq.${sessionId}` }, (payload: any) => {
        if (payload.new?.status === "completed") setMySession((prev) => prev ? { ...prev, status: "completed" } : prev);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "skeeball_ball_scores", filter: `session_id=eq.${sessionId}` }, (payload: any) => {
        setBallScores((prev) => [
          ...prev.filter((b) => !(b.player_user_id === payload.new.player_user_id && b.ball_number === payload.new.ball_number)),
          payload.new as BallScore,
        ]);
      })
      .subscribe();
  }

  async function startSession() {
    if (!user || !teamId || selectedPlayers.length < MIN_PLAYERS || !selectedLane) return;
    setStarting(true);
    setError(null);
    try {
      // Get or create a league match for this week's session
      const { data: matchData } = await supabase.rpc("rpc_skeeball_get_or_create_match", {
        p_week_of: getMondayDate(),
      });
      const matchId: string | null = (matchData as any)?.match_id ?? null;

      const { data: session, error: sErr } = await supabase
        .from("skeeball_sessions")
        .insert({ team_id: teamId, lane_number: selectedLane, week_of: getMondayDate(), created_by: user.id, status: "active", last_activity_at: new Date().toISOString(), league_match_id: matchId })
        .select()
        .single();
      if (sErr) throw sErr;

      const { error: pErr } = await supabase
        .from("skeeball_session_players")
        .insert(selectedPlayers.map((pid) => ({ session_id: session.id, player_user_id: pid })));
      if (pErr) throw pErr;

      const newSession: LaneSession = { id: session.id, team_id: teamId, lane_number: selectedLane, status: "active", last_activity_at: new Date().toISOString(), league_match_id: matchId };
      setMySession(newSession);
      await loadSessionData(session.id);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to start game";
      reportError("SkeeballTracker.startSession", msg);
      setError(msg);
    } finally {
      setStarting(false);
    }
  }

  async function moveInOrder(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= sessionPlayers.length || !mySession) return;
    const next = [...sessionPlayers];
    [next[index], next[target]] = [next[target], next[index]];
    const ordered = next.map((p, i) => ({ ...p, shoot_position: i + 1 }));
    setSessionPlayers(ordered);
    setSavingOrder(true);
    try {
      const { data, error } = await supabase.rpc("rpc_skeeball_set_lineup_order", {
        p_session_id: mySession.id,
        p_ordered_user_ids: ordered.map((p) => p.player_user_id),
      });
      if (error || (data as any)?.error) {
        reportError("SkeeballTracker.moveInOrder", (data as any)?.message ?? error?.message ?? "order failed");
      }
    } finally {
      setSavingOrder(false);
    }
  }

  async function swapIntoLineup(inUserId: string) {
    if (!mySession || savingOrder || sessionPlayers.length === 0) return;
    const outPlayer = sessionPlayers[sessionPlayers.length - 1];
    setSavingOrder(true);
    try {
      const { data, error } = await supabase.rpc("rpc_skeeball_swap_session_player", {
        p_session_id: mySession.id,
        p_out_user_id: outPlayer.player_user_id,
        p_in_user_id: inUserId,
      });
      if (error || (data as any)?.error) {
        showToast((data as any)?.message ?? "Couldn't swap players.", "error");
        return;
      }
      const member = teamMembers.find((m) => m.user_id === inUserId);
      setSessionPlayers((prev) => prev.map((sp) =>
        sp.player_user_id === outPlayer.player_user_id
          ? { ...sp, player_user_id: inUserId, username: member?.username ?? "Unknown", avatar_url: member?.avatar_url ?? null }
          : sp
      ));
      showToast(`${member?.username ?? "Player"} swapped in for ${outPlayer.username}`);
    } finally {
      setSavingOrder(false);
    }
  }

  async function submitBalls() {
    if (!user || !mySession) return;
    const totalEntered = sessionPlayers.reduce((s, sp) => s + (playerBalls[sp.player_user_id] ?? []).length, 0);
    const allLocalDone = totalEntered >= TOTAL_BALLS;
    if (!allLocalDone) { setSubmitError("Enter all ball scores before submitting."); return; }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const balls = sessionPlayers.flatMap((sp) =>
        (playerBalls[sp.player_user_id] ?? []).map((score, i) => ({
          player_user_id: sp.player_user_id,
          ball_number: i + 1,
          score,
        }))
      );
      const { data, error } = await supabase.rpc("rpc_skeeball_submit_balls", {
        p_session_id: mySession!.id,
        p_balls: balls,
      });
      if (error) throw error;
      if ((data as any)?.error) {
        const msg = (data as any).message ?? "Failed to submit scores.";
        reportError("SkeeballTracker.submitBalls", msg);
        setSubmitError(msg);
        return;
      }
      const asBallScores: BallScore[] = sessionPlayers.flatMap((sp) =>
        (playerBalls[sp.player_user_id] ?? []).map((score, i) => ({
          id: `local_${sp.player_user_id}_${i}`,
          session_id: mySession!.id,
          player_user_id: sp.player_user_id,
          ball_number: i + 1,
          score,
        }))
      );
      setBallScores(asBallScores);
      setShowWarning(false);
      setWarningCountdown(WARNING_DURATION_S);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to submit scores";
      reportError("SkeeballTracker.submitBalls", msg);
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function addBall(pts: number) {
    setPlayerBalls((prev) => {
      const total = sessionPlayers.reduce((s, sp) => s + (prev[sp.player_user_id] ?? []).length, 0);
      if (total >= TOTAL_BALLS) return prev;
      const round = Math.floor(total / BALLS_PER_ROUND);
      const sp = sessionPlayers[round % sessionPlayers.length];
      if (!sp) return prev;
      return { ...prev, [sp.player_user_id]: [...(prev[sp.player_user_id] ?? []), pts] };
    });
  }

  function undoLastBall() {
    setPlayerBalls((prev) => {
      const total = sessionPlayers.reduce((s, sp) => s + (prev[sp.player_user_id] ?? []).length, 0);
      if (total === 0) return prev;
      const lastRound = Math.floor((total - 1) / BALLS_PER_ROUND);
      const sp = sessionPlayers[lastRound % sessionPlayers.length];
      if (!sp) return prev;
      return { ...prev, [sp.player_user_id]: (prev[sp.player_user_id] ?? []).slice(0, -1) };
    });
  }

  async function stayActive() {
    if (!mySession) return;
    const now = new Date().toISOString();
    await supabase.from("skeeball_sessions").update({ last_activity_at: now }).eq("id", mySession.id);
    setMySession((prev) => prev ? { ...prev, last_activity_at: now } : prev);
    setShowWarning(false);
    setWarningCountdown(WARNING_DURATION_S);
  }

  function kickTeam(session: LaneSession) {
    Alert.alert(
      "Kick Team Off Lane",
      `Remove ${session.team_name ?? "this team"} from Lane ${session.lane_number}? Their scores will not be saved.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Kick Off Lane", style: "destructive",
          onPress: async () => {
            await supabase.from("skeeball_sessions").update({ status: "abandoned" }).eq("id", session.id).eq("status", "active");
            setAllActiveSessions((prev) => prev.filter((s) => s.id !== session.id));
            if (mySession?.id === session.id) {
              setMySession(null);
              setSessionPlayers([]);
              setBallScores([]);
            }
          },
        },
      ]
    );
  }

  async function abandonSession(sessionId: string) {
    await supabase
      .from("skeeball_sessions")
      .update({ status: "abandoned" })
      .eq("id", sessionId)
      .eq("status", "active");
    setMySession(null);
    setSessionPlayers([]);
    setBallScores([]);
    setAllActiveSessions((prev) => prev.filter((s) => s.id !== sessionId));
  }

  async function completeSession() {
    if (!mySession || mySession.status !== "active") return;

    const { data, error } = await supabase.rpc("rpc_skeeball_complete_session", {
      p_session_id: mySession.id,
    });
    if (error) {
      reportError("SkeeballTracker.completeSession", error.message);
      setSubmitError(error.message);
      return;
    }

    const result = data as {
      ok?: boolean;
      error?: string;
      message?: string;
      placement?: number | null;
      league_points?: number | null;
    };
    if (!result?.ok) {
      const msg = result?.message ?? "Could not finalize this game.";
      reportError("SkeeballTracker.completeSession", msg);
      setSubmitError(msg);
      return;
    }
    setMySession((prev) => prev ? {
      ...prev,
      status: "completed",
      placement: result.placement ?? prev.placement,
      league_points: result.league_points ?? prev.league_points,
    } : prev);

    // If this completion finalized the whole round, push results to every team.
    // Server dedupes via notified_at, so racing clients can't double-send.
    if (result.placement != null && mySession.league_match_id) {
      notifyRoundFinal(mySession.league_match_id);
    }
  }

  async function notifyRoundFinal(matchId: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      await fetch(`${API_BASE}/api/push/league`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: "round_final", matchId }),
      });
    } catch {
      // push is best-effort
    }
  }

  function togglePlayer(uid: string) {
    setSelectedPlayers((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : prev.length < PLAYERS_PER_GAME ? [...prev, uid] : prev
    );
  }

  function leaveScreen() {
    if (onBack) { onBack(); return; }
    router.canGoBack() ? router.back() : router.replace("/teams" as any);
  }

  async function checkOutAndLeave(force: boolean) {
    if (mySession?.id) {
      try {
        await supabase.rpc("rpc_skeeball_cancel_session", { p_session_id: mySession.id, p_force: force });
      } catch { /* leave anyway */ }
    }
    leaveScreen();
  }

  // Android hardware back routes through the same check-out logic.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { goBack(); return true; });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySession, playerBalls, ballScores, sessionPlayers]);

  // Back = check the team out of the lane. Silent if nothing's been entered;
  // confirm first (and discard) if balls are already recorded.
  function goBack() {
    if (mySession?.status === "active") {
      const enteredLocal = sessionPlayers.reduce(
        (s, sp) => s + (playerBalls[sp.player_user_id] ?? []).length, 0
      );
      const entered = enteredLocal + ballScores.length;
      if (entered > 0) {
        Alert.alert(
          "Discard this game?",
          `You've recorded ${entered} ball${entered === 1 ? "" : "s"}. Going back checks ${mySession.team_name ?? "your team"} out of Lane ${mySession.lane_number} and discards these scores — they won't be saved.`,
          [
            { text: "Keep Playing", style: "cancel" },
            { text: "Discard & Exit", style: "destructive", onPress: () => checkOutAndLeave(true) },
          ]
        );
        return;
      }
      checkOutAndLeave(false);
      return;
    }
    leaveScreen();
  }

  // ─── Inactivity warning modal (shown over any active session view) ───────────

  const warningModal = (
    <Modal visible={showWarning} transparent animationType="fade" statusBarTranslucent>
      <View style={s.warningOverlay}>
        <View style={s.warningCard}>
          <View style={s.warningIconWrap}>
            <Ionicons name="warning" size={36} color="#ef4444" />
          </View>
          <Text style={s.warningTitle}>Inactivity Detected</Text>
          <Text style={s.warningSub}>
            You will be removed from Lane {mySession?.lane_number} due to inactivity in
          </Text>
          <Text style={s.warningCountdown}>
            {String(Math.floor(warningCountdown / 60)).padStart(2, "0")}:{String(warningCountdown % 60).padStart(2, "0")}
          </Text>
          <Pressable style={s.warningBtn} onPress={stayActive}>
            <Ionicons name="checkmark-circle-outline" size={20} color="#000" />
            <Text style={s.warningBtnText}>I'm Still Here</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  // ─── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.topBar}><Pressable style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable></View>
        <View style={s.centered}><ActivityIndicator size="large" color="#06b6d4" /></View>
      </SafeAreaView>
    );
  }

  // ─── Not Monday (admins and QR sessions can always access) ───────────────────

  if (!isMonday() && !isAdmin && !cameFromQr) {
    return (
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        <View style={s.topBar}><Pressable style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable></View>
        <View style={s.centered}>
          <Ionicons name="calendar-outline" size={56} color="#2a2a2a" style={{ marginBottom: 20 }} />
          <Text style={s.bigTitle}>League Night is Monday</Text>
          <Text style={s.bigSub}>Score tracking opens on Mondays only.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Complete ─────────────────────────────────────────────────────────────────

  if (sessionDone) {
    const teamTotal = sessionPlayers.reduce((sum, sp) => sum + ballScores.filter((b) => b.player_user_id === sp.player_user_id).reduce((s, b) => s + b.score, 0), 0);
    const placement = mySession?.placement ?? null;
    const leaguePoints = mySession?.league_points ?? null;
    const placementEmoji = placement === 1 ? "🥇" : placement === 2 ? "🥈" : placement === 3 ? "🥉" : placement === 4 ? "4️⃣" : null;
    const placementLabel = placement === 1 ? "1st Place" : placement === 2 ? "2nd Place" : placement === 3 ? "3rd Place" : placement === 4 ? "4th Place" : null;
    const placementColor = placement === 1 ? "#f59e0b" : placement === 2 ? "#94a3b8" : placement === 3 ? "#cd7c2f" : "#555";
    return (
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        <View style={s.topBar}><Pressable style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable></View>
        <View style={s.centered}>
          <View style={s.trophyWrap}><Ionicons name="trophy" size={48} color="#f59e0b" /></View>
          <Text style={s.bigTitle}>Game Complete!</Text>
          <Text style={s.bigSub}>Scores submitted for review.</Text>
          {(() => {
            const myTotal = ballScores
              .filter((b) => b.player_user_id === user?.id)
              .reduce((sum, b) => sum + b.score, 0);
            if (myPrevBest != null && myTotal > myPrevBest) {
              return (
                <View style={s.pbBanner}>
                  <Text style={s.pbEmoji}>🎉</Text>
                  <View>
                    <Text style={s.pbTitle}>New personal best!</Text>
                    <Text style={s.pbSub}>{myTotal} pts — previous best was {myPrevBest}</Text>
                  </View>
                </View>
              );
            }
            return null;
          })()}
          {placementLabel && (
            <View style={[s.placementBadge, { borderColor: placementColor + "44" }]}>
              <Text style={s.placementEmoji}>{placementEmoji}</Text>
              <View>
                <Text style={[s.placementLabel, { color: placementColor }]}>{placementLabel}</Text>
                {leaguePoints != null && (
                  <Text style={s.placementPts}>+{leaguePoints} league point{leaguePoints !== 1 ? "s" : ""}</Text>
                )}
              </View>
            </View>
          )}
          <View style={s.resultCard}>
            {sessionPlayers.map((sp) => {
              const pts = ballScores.filter((b) => b.player_user_id === sp.player_user_id).reduce((sum, b) => sum + b.score, 0);
              const playerBalls = ballScores.filter((b) => b.player_user_id === sp.player_user_id).sort((a, b) => a.ball_number - b.ball_number);
              return (
                <View key={sp.player_user_id} style={s.resultRow}>
                  <Avatar uri={sp.avatar_url} name={sp.username} size={36} radius={11} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={s.resultName}>{sp.username}</Text>
                    <Text style={s.resultBalls}>{playerBalls.map((b) => b.score).join(" · ")} pts</Text>
                  </View>
                  <Text style={s.resultTotal}>{pts}</Text>
                </View>
              );
            })}
            <View style={s.resultDivider} />
            <View style={s.resultTotalRow}>
              <Text style={s.resultTotalLabel}>Team Total</Text>
              <Text style={s.resultTotalValue}>{teamTotal}</Text>
            </View>
          </View>
          <Pressable style={s.doneBtn} onPress={goBack}><Text style={s.doneBtnText}>Back to Team</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Waiting (I submitted, waiting for teammates) ─────────────────────────────

  if (mySession && iAmPlayer && allBallsSubmitted) {
    return (
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        {warningModal}
        <View style={s.topBar}>
          <Pressable style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
          <Text style={s.topBarTitle}>Lane {mySession.lane_number}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.centered}>
          <View style={s.waitWrap}><ActivityIndicator size="large" color="#06b6d4" /></View>
          <Text style={s.bigTitle}>Scores Submitted!</Text>
          <Text style={s.bigSub}>Finalizing results…</Text>
          <View style={{ width: "100%", paddingHorizontal: 24, marginTop: 32 }}>
            {playerProgress.map((pp) => (
              <ProgressRow key={pp.player_user_id} pp={pp} isMe={pp.player_user_id === user?.id} />
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Spectating (not in lineup) ───────────────────────────────────────────────

  if (mySession && !iAmPlayer) {
    return (
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        <View style={s.topBar}>
          <Pressable style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
          <Text style={s.topBarTitle}>Lane {mySession.lane_number}</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.spectatorNote}>You're not in the lineup this game.</Text>
          <Text style={s.sectionLabel}>Team Progress</Text>
          {playerProgress.map((pp) => (
            <ProgressRow key={pp.player_user_id} pp={pp} isMe={pp.player_user_id === user?.id} card />
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Scoring (ring-tap) ───────────────────────────────────────────────────────

  if (mySession && iAmPlayer && !allBallsSubmitted) {
    const totalEntered = sessionPlayers.reduce((s, sp) => s + (playerBalls[sp.player_user_id] ?? []).length, 0);
    const allLocalDone = totalEntered >= TOTAL_BALLS;
    const currentRound = Math.floor(totalEntered / BALLS_PER_ROUND);
    const ballInRound = totalEntered % BALLS_PER_ROUND;
    const activePlayerIdx = currentRound % sessionPlayers.length;
    const currentSp = sessionPlayers[activePlayerIdx];
    const currentBalls = playerBalls[currentSp?.player_user_id] ?? [];
    const currentTotal = currentBalls.reduce((s, b) => s + b, 0);
    const currentMaxBalls = getExpectedBallsForPlayer(activePlayerIdx, sessionPlayers.length);
    const grandTotal = sessionPlayers.reduce(
      (sum, sp) => sum + (playerBalls[sp.player_user_id] ?? []).reduce((s, b) => s + b, 0), 0
    );
    const hundoTotal = sessionPlayers.reduce(
      (sum, sp) => sum + (playerBalls[sp.player_user_id] ?? []).filter((b) => b === 100).length, 0
    );

    return (
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        {warningModal}
        <View style={s.topBar}>
          <Pressable style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
          <Text style={s.topBarTitle}>Lane {mySession.lane_number}</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={s.scroll}>

          {/* ── Hundo Week banner (week 7: only 100s decide the winner) ── */}
          {isHundoWeek && (
            <View style={s.hundoBanner}>
              <Text style={s.hundoBannerEmoji}>💯</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.hundoBannerTitle}>HUNDO WEEK</Text>
                <Text style={s.hundoBannerSub}>Only 100-ring balls decide the win. Most 100s takes the round — keep recording every ball.</Text>
              </View>
              <View style={s.hundoCount}>
                <ScoreText value={hundoTotal} style={s.hundoCountNum} />
                <Text style={s.hundoCountLabel}>100s</Text>
              </View>
            </View>
          )}

          {/* ── Shooting order (editable until the first ball) ── */}
          {totalEntered === 0 && ballScores.length === 0 && sessionPlayers.length > 1 && (
            <View style={s.orderCard}>
              <View style={s.orderHeader}>
                <Ionicons name="swap-vertical-outline" size={15} color="#06b6d4" />
                <Text style={s.orderTitle}>Shooting Order</Text>
                {savingOrder && <ActivityIndicator size="small" color="#06b6d4" />}
              </View>
              <Text style={s.orderHint}>
                Set who shoots first, second, and last — this is tracked for season lineup stats.
              </Text>
              {sessionPlayers.map((sp, idx) => (
                <View key={sp.player_user_id} style={s.orderRow}>
                  <View style={s.orderPosBadge}>
                    <Text style={s.orderPosText}>{idx + 1}</Text>
                  </View>
                  <Avatar uri={sp.avatar_url} name={sp.username} size={28} radius={9} />
                  <Text style={s.orderName}>{sp.username}</Text>
                  <Pressable
                    style={[s.orderArrow, idx === 0 && { opacity: 0.25 }]}
                    onPress={() => moveInOrder(idx, -1)}
                    disabled={idx === 0 || savingOrder}
                    hitSlop={6}
                  >
                    <Ionicons name="chevron-up" size={17} color="#06b6d4" />
                  </Pressable>
                  <Pressable
                    style={[s.orderArrow, idx === sessionPlayers.length - 1 && { opacity: 0.25 }]}
                    onPress={() => moveInOrder(idx, 1)}
                    disabled={idx === sessionPlayers.length - 1 || savingOrder}
                    hitSlop={6}
                  >
                    <Ionicons name="chevron-down" size={17} color="#06b6d4" />
                  </Pressable>
                </View>
              ))}

              {/* Bench — rest of the roster; swap into this game's lineup */}
              {teamMembers.filter((m) => !sessionPlayers.some((sp) => sp.player_user_id === m.user_id)).length > 0 && (
                <>
                  <Text style={[s.orderHint, { marginTop: 10 }]}>
                    Bench — tap to swap a player into this game (replaces the last shooter):
                  </Text>
                  {teamMembers
                    .filter((m) => !sessionPlayers.some((sp) => sp.player_user_id === m.user_id))
                    .map((m) => (
                      <View key={m.user_id} style={[s.orderRow, { opacity: savingOrder ? 0.5 : 1 }]}>
                        <View style={[s.orderPosBadge, { backgroundColor: "#1a1a1a" }]}>
                          <Ionicons name="remove" size={12} color="#666" />
                        </View>
                        <Avatar uri={m.avatar_url} name={m.username} size={28} radius={9} />
                        <Text style={[s.orderName, { color: "#999" }]}>{m.username}</Text>
                        <Pressable
                          style={s.orderArrow}
                          onPress={() => swapIntoLineup(m.user_id)}
                          disabled={savingOrder}
                          hitSlop={6}
                        >
                          <Ionicons name="swap-horizontal" size={17} color="#22c55e" />
                        </Pressable>
                      </View>
                    ))}
                </>
              )}
            </View>
          )}

          {/* ── Active player — ring tap ──────────────────────── */}
          {!allLocalDone && currentSp && (
            <View style={s.playerSection}>
              <View style={s.playerSectionHeader}>
                <Avatar uri={currentSp.avatar_url} name={currentSp.username} size={32} radius={10} />
                <Text style={s.playerSectionName}>{currentSp.username}</Text>
                {currentSp.player_user_id === user?.id && (
                  <View style={s.youChip}><Text style={s.youChipText}>You</Text></View>
                )}
                <Text style={s.playerSectionTotal}>{currentTotal} pts</Text>
              </View>

              {currentBalls.length < currentMaxBalls ? (
                <>
                  <Text style={s.ringHint}>
                    Round {currentRound + 1} · Ball {ballInRound + 1} — pick ring
                  </Text>
                  <View style={s.ringGrid}>
                    {SKEE_RINGS.map((pts) => (
                      <PressableScale
                        key={pts}
                        style={[s.ringBtn, pts === 100 && s.ringBtnCenter, { borderColor: RING_COLORS[pts] + "66" }]}
                        onPress={() => addBall(pts)}
                      >
                        <ScoreText value={pts} style={[s.ringBtnText, { color: RING_COLORS[pts] }, pts === 100 && s.ringBtnTextCenter]} />
                      </PressableScale>
                    ))}
                  </View>
                  {currentBalls.length > 0 && (
                    <View style={s.historyRow}>
                      <View style={s.historyChips}>
                        {currentBalls.map((pts, i) => (
                          <View key={i} style={[s.chip, { borderColor: RING_COLORS[pts] + "44", backgroundColor: RING_COLORS[pts] + "18" }]}>
                            <Text style={[s.chipText, { color: RING_COLORS[pts] }]}>{pts}</Text>
                          </View>
                        ))}
                      </View>
                      <Pressable style={s.undoBtn} onPress={undoLastBall}>
                        <Ionicons name="arrow-undo-outline" size={13} color="#555" />
                        <Text style={s.undoText}>Undo</Text>
                      </Pressable>
                    </View>
                  )}
                </>
              ) : (
                <View style={s.completeRow}>
                  <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
                  <Text style={s.completeText}>Done!</Text>
                </View>
              )}
            </View>
          )}

          {/* ── Other players — done or up next ──────────────── */}
          {sessionPlayers.map((sp, playerIdx) => {
            const isActive = playerIdx === activePlayerIdx && !allLocalDone;
            if (isActive) return null;
            const spBalls = playerBalls[sp.player_user_id] ?? [];
            const isDone = spBalls.length >= getExpectedBallsForPlayer(playerIdx, sessionPlayers.length);
            const spTotal = spBalls.reduce((s, b) => s + b, 0);
            return (
              <View key={sp.player_user_id} style={[s.playerSection, !isDone && s.playerSectionDim]}>
                <View style={s.playerSectionHeader}>
                  <Avatar uri={sp.avatar_url} name={sp.username} size={32} radius={10} />
                  <Text style={s.playerSectionName}>{sp.username}</Text>
                  {sp.player_user_id === user?.id && (
                    <View style={s.youChip}><Text style={s.youChipText}>You</Text></View>
                  )}
                  <Text style={s.playerSectionTotal}>{isDone ? `${spTotal} pts` : "—"}</Text>
                </View>
                {isDone ? (
                  <View style={s.historyRow}>
                    <View style={s.historyChips}>
                      {spBalls.map((pts, i) => (
                        <View key={i} style={[s.chip, { borderColor: RING_COLORS[pts] + "44", backgroundColor: RING_COLORS[pts] + "18" }]}>
                          <Text style={[s.chipText, { color: RING_COLORS[pts] }]}>{pts}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : (
                  <Text style={s.upNextText}>Up next</Text>
                )}
              </View>
            );
          })}

          {/* ── Team total + submit ───────────────────────────── */}
          {sessionPlayers.length > 1 && (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Team total</Text>
              <ScoreText value={grandTotal} animate suffix=" pts" style={s.totalValue} />
            </View>
          )}

          {submitError && (
            <View style={s.errorBox}>
              <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
              <Text style={s.errorText}>{submitError}</Text>
            </View>
          )}

          {allLocalDone && (
            <Pressable
              style={[s.submitBtn, submitting && s.btnOff]}
              onPress={submitBalls}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator size="small" color="#000" />
                : <Ionicons name="checkmark-circle-outline" size={20} color="#000" />}
              <Text style={s.submitBtnText}>Submit All Scores</Text>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Setup (no active session) ────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <View style={s.topBar}>
        <Pressable style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
        <Text style={s.topBarTitle}>Track Scores</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={s.scroll}>
        {error && (
          <View style={s.errorBox}>
            <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <Text style={s.sectionLabel}>
          Select Shooters{" "}
          <Text style={{ color: selectedPlayers.length >= MIN_PLAYERS ? "#22c55e" : "#555" }}>
            ({selectedPlayers.length}/{PLAYERS_PER_GAME})
          </Text>
        </Text>
        {teamMembers.map((m) => {
          const selected = selectedPlayers.includes(m.user_id);
          const maxed = !selected && selectedPlayers.length >= PLAYERS_PER_GAME;
          return (
            <Pressable
              key={m.user_id}
              style={[s.memberRow, selected && s.memberRowSel, maxed && s.memberRowDim]}
              onPress={() => !maxed && togglePlayer(m.user_id)}
            >
              <Avatar uri={m.avatar_url} name={m.username} size={40} radius={12} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[s.memberName, selected && { color: "#fff" }]}>{m.username}</Text>
                {m.role === "captain" && <Text style={s.capLabel}>Captain</Text>}
              </View>
              <View style={[s.checkbox, selected && s.checkboxSel]}>
                {selected && <Ionicons name="checkmark" size={14} color="#000" />}
              </View>
            </Pressable>
          );
        })}

        <Text style={[s.sectionLabel, { marginTop: 28 }]}>Select Lane</Text>
        <View style={s.laneGrid}>
          {Array.from({ length: LANE_COUNT }, (_, i) => {
            const lane = i + 1;
            const taken = takenLanes.has(lane);
            const takenBy = allActiveSessions.find((s) => s.lane_number === lane);
            const sel = selectedLane === lane;
            return (
              <View key={lane} style={[s.laneBtn, sel && s.laneBtnSel, taken && s.laneBtnTaken]}>
                <Pressable
                  style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 2, width: "100%" }}
                  onPress={() => !taken && setSelectedLane(sel ? null : lane)}
                  disabled={taken}
                >
                  <Text style={[s.laneBtnNum, sel && { color: "#000" }, taken && { color: "#333" }]}>{lane}</Text>
                  <Text style={[s.laneBtnStatus, sel && { color: "#000" }, taken && { color: "#ef4444" }]}>
                    {taken ? "Locked" : sel ? "Selected" : "Open"}
                  </Text>
                  {taken && takenBy?.team_name && (
                    <Text style={s.laneTeamName} numberOfLines={1}>{takenBy.team_name}</Text>
                  )}
                </Pressable>
                {taken && isAdmin && takenBy && (
                  <Pressable style={s.kickBtn} onPress={() => kickTeam(takenBy)}>
                    <Ionicons name="close-circle" size={16} color="#ef4444" />
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>

        <Pressable
          style={[s.submitBtn, (selectedPlayers.length < MIN_PLAYERS || !selectedLane || starting) && s.btnOff]}
          onPress={startSession}
          disabled={selectedPlayers.length < MIN_PLAYERS || !selectedLane || starting}
        >
          {starting ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="play-circle-outline" size={22} color="#000" />}
          <Text style={s.submitBtnText}>{starting ? "Starting…" : "Start Game"}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressRow({ pp, isMe, card }: { pp: { player_user_id: string; username: string; avatar_url: string | null; balls: number; expectedBalls: number }; isMe: boolean; card?: boolean }) {
  const done = pp.balls >= pp.expectedBalls;
  return (
    <View style={[s.progressRow, card && s.progressCard]}>
      <Avatar uri={pp.avatar_url} name={pp.username} size={36} radius={11} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={s.progressName}>{pp.username}</Text>
          {isMe && <View style={s.youChip}><Text style={s.youChipText}>You</Text></View>}
        </View>
        <Text style={s.progressSub}>{pp.balls}/{pp.expectedBalls} balls submitted</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
        {Array.from({ length: pp.expectedBalls }, (_, i) => (
          <View key={i} style={[s.ballDot, i < pp.balls && s.ballDotFilled]} />
        ))}
        {done && <Ionicons name="checkmark-circle" size={18} color="#22c55e" style={{ marginLeft: 4 }} />}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  scroll: { padding: 20, paddingBottom: 48 },

  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10 },
  topBarTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },

  bigTitle: { color: "#fff", fontSize: 26, fontWeight: "900", textAlign: "center", marginBottom: 8 },
  bigSub: { color: "#8a8a8a", fontSize: 14, textAlign: "center" },

  sectionLabel: { color: "#777", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 12 },
  spectatorNote: { color: "#8a8a8a", fontSize: 14, textAlign: "center", marginBottom: 24 },

  trophyWrap: { width: 96, height: 96, borderRadius: 48, backgroundColor: "rgba(245,158,11,0.1)", alignItems: "center", justifyContent: "center", marginBottom: 24, borderWidth: 1, borderColor: "rgba(245,158,11,0.25)" },
  placementBadge: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#111", borderRadius: 16, paddingHorizontal: 20, paddingVertical: 14, borderWidth: 1, marginTop: 4, marginBottom: 4 },
  placementEmoji: { fontSize: 32 },
  placementLabel: { fontSize: 20, fontWeight: "900" },
  placementPts: { color: "#8a8a8a", fontSize: 13, fontWeight: "600", marginTop: 2 },
  waitWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(6,182,212,0.1)", alignItems: "center", justifyContent: "center", marginBottom: 24 },

  resultCard: { width: "100%", backgroundColor: "#111", borderRadius: 20, padding: 20, marginTop: 24, borderWidth: 1, borderColor: "#1a1a1a" },
  resultRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  resultName: { color: "#fff", fontSize: 15, fontWeight: "800" },
  resultBalls: { color: "#777", fontSize: 12, marginTop: 2 },
  resultTotal: { color: "#06b6d4", fontSize: 22, fontWeight: "900" },
  resultDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#2a2a2a", marginVertical: 12 },
  resultTotalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  resultTotalLabel: { color: "#8a8a8a", fontSize: 14, fontWeight: "700" },
  resultTotalValue: { color: "#22c55e", fontSize: 28, fontWeight: "900" },

  doneBtn: { backgroundColor: "#06b6d4", borderRadius: 18, paddingHorizontal: 32, paddingVertical: 16, marginTop: 32 },
  doneBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },

  laneChip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(6,182,212,0.1)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, alignSelf: "flex-start", marginBottom: 20, borderWidth: 1, borderColor: "rgba(6,182,212,0.2)" },
  laneChipText: { color: "#06b6d4", fontWeight: "800", fontSize: 14 },
  scoreTitle: { color: "#fff", fontSize: 22, fontWeight: "900", marginBottom: 6 },
  scoreSub: { color: "#8a8a8a", fontSize: 13, marginBottom: 24 },

  orderCard: {
    backgroundColor: "rgba(6,182,212,0.04)", borderRadius: 16, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.18)",
  },
  orderHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 4 },
  orderTitle: { color: "#fff", fontSize: 14, fontWeight: "800", flex: 1 },
  orderHint: { color: "#8a8a8a", fontSize: 11.5, lineHeight: 16, marginBottom: 10 },
  orderRow: {
    flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(6,182,212,0.12)",
  },
  orderPosBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(6,182,212,0.12)", alignItems: "center", justifyContent: "center",
  },
  orderPosText: { color: "#06b6d4", fontSize: 11, fontWeight: "900" },
  orderName: { flex: 1, color: "#fff", fontSize: 13.5, fontWeight: "700" },
  orderArrow: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },

  pbBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(34,197,94,0.07)", borderRadius: 16, padding: 14, marginTop: 14,
    borderWidth: 1, borderColor: "rgba(34,197,94,0.25)",
  },
  pbEmoji: { fontSize: 26 },
  pbTitle: { color: "#22c55e", fontSize: 15, fontWeight: "900" },
  pbSub: { color: "#777", fontSize: 12.5, marginTop: 2 },

  playerSection: { backgroundColor: "#111", borderRadius: 16, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: "#1a1a1a" },
  playerSectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  playerSectionName: { color: "#fff", fontSize: 14, fontWeight: "800", flex: 1 },
  playerSectionTotal: { color: "#06b6d4", fontSize: 16, fontWeight: "900" },

  ballRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#0d0d0d", borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#1a1a1a", gap: 12 },
  ballLabel: { color: "#8a8a8a", fontSize: 14, fontWeight: "700", width: 48 },
  ballInput: { flex: 1, color: "#fff", fontSize: 28, fontWeight: "900", textAlign: "center" },
  ballUnit: { color: "#333", fontSize: 13, fontWeight: "700", width: 28, textAlign: "right" },
  hundoBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(245,158,11,0.08)", borderRadius: 16, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.35)",
  },
  hundoBannerEmoji: { fontSize: 28 },
  hundoBannerTitle: { color: "#f59e0b", fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  hundoBannerSub: { color: "#d6a850", fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  hundoCount: { alignItems: "center", minWidth: 48 },
  hundoCountNum: { color: "#f59e0b", fontSize: 26, fontWeight: "900" },
  hundoCountLabel: { color: "#8a7a4a", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },

  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#0d0d0d", borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: "#1a1a1a" },
  totalLabel: { color: "#8a8a8a", fontSize: 14 },
  totalValue: { color: "#06b6d4", fontSize: 22, fontWeight: "900" },

  submitBtn: { backgroundColor: "#06b6d4", borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 18, marginBottom: 12 },
  submitBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
  btnOff: { backgroundColor: "#141414" },

  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },

  memberRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#111", borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#1a1a1a" },
  memberRowSel: { backgroundColor: "rgba(6,182,212,0.08)", borderColor: "rgba(6,182,212,0.3)" },
  memberRowDim: { opacity: 0.4 },
  memberName: { color: "#777", fontSize: 15, fontWeight: "700" },
  capLabel: { color: "#f59e0b", fontSize: 11, fontWeight: "700", marginTop: 2 },
  checkbox: { width: 26, height: 26, borderRadius: 8, backgroundColor: "#1a1a1a", borderWidth: 1.5, borderColor: "#2a2a2a", alignItems: "center", justifyContent: "center" },
  checkboxSel: { backgroundColor: "#06b6d4", borderColor: "#06b6d4" },

  laneGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 28 },
  laneBtn: { width: "31%", height: 72, backgroundColor: "#111", borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#1a1a1a", gap: 2, paddingHorizontal: 6 },
  laneBtnSel: { backgroundColor: "#06b6d4", borderColor: "#06b6d4" },
  laneBtnTaken: { backgroundColor: "#0d0d0d", borderColor: "#1a1a1a" },
  laneBtnNum: { color: "#fff", fontSize: 22, fontWeight: "900" },
  laneBtnStatus: { color: "#777", fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  laneTeamName: { color: "#8a8a8a", fontSize: 10, textAlign: "center", paddingHorizontal: 2 },

  progressRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  progressCard: { backgroundColor: "#111", borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#1a1a1a", borderBottomWidth: 0 },
  progressName: { color: "#fff", fontSize: 14, fontWeight: "800" },
  progressSub: { color: "#777", fontSize: 12, marginTop: 1 },
  youChip: { backgroundColor: "rgba(6,182,212,0.12)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  youChipText: { color: "#06b6d4", fontSize: 10, fontWeight: "900" },
  ballDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#1e1e1e", borderWidth: 1, borderColor: "#2a2a2a" },
  ballDotFilled: { backgroundColor: "#22c55e", borderColor: "#22c55e" },

  kickBtn: { position: "absolute", top: 4, right: 4, padding: 2 },

  // Ring-tap scoring
  ringHint: { color: "#8a8a8a", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },
  ringGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14, justifyContent: "center" },
  ringBtn: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: "#111",
    borderWidth: 2, alignItems: "center", justifyContent: "center",
    alignSelf: "center",
  },
  ringBtnCenter: { width: "100%", height: 60, borderRadius: 30 },
  ringBtnText: { fontSize: 22, fontWeight: "900" },
  ringBtnTextCenter: { fontSize: 20 },

  historyRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  historyChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1 },
  chip: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1 },
  chipText: { fontSize: 14, fontWeight: "900" },
  undoBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 10 },
  undoText: { color: "#8a8a8a", fontSize: 12 },

  completeRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4 },
  completeText: { color: "#22c55e", fontSize: 14, fontWeight: "800" },
  playerSectionDim: { opacity: 0.5 },
  upNextText: { color: "#777", fontSize: 12, fontStyle: "italic", paddingTop: 4 },

  warningOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 32 },
  warningCard: { width: "100%", backgroundColor: "#111", borderRadius: 24, padding: 28, alignItems: "center", borderWidth: 1.5, borderColor: "rgba(239,68,68,0.4)" },
  warningIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(239,68,68,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 20, borderWidth: 1, borderColor: "rgba(239,68,68,0.3)" },
  warningTitle: { color: "#ef4444", fontSize: 22, fontWeight: "900", marginBottom: 10, textAlign: "center" },
  warningSub: { color: "#7a7a7a", fontSize: 14, textAlign: "center", marginBottom: 16, lineHeight: 20 },
  warningCountdown: { color: "#ef4444", fontSize: 56, fontWeight: "900", letterSpacing: 2, marginBottom: 28 },
  warningBtn: { backgroundColor: "#06b6d4", borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, paddingHorizontal: 32 },
  warningBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
});
