import { SessionFinish } from "../components/session-finish";
import { publicProfilesById } from "../../lib/public-profiles";
import Ionicons from "@expo/vector-icons/Ionicons";
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
import { haptic } from "../../lib/haptics";
import { queueSubmit, looksOffline, discardQueuedSubmission, pendingSubmissions } from "../../lib/offline-queue";
import { useActiveGame } from "../context/active-game-context";
import { restoreBalls } from "../../lib/experience";

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
  10: "#a3adb8", 20: "#a3adb8", 30: "#3b82f6", 40: "#8b5cf6", 50: "#22c55e", 100: "#06b6d4",
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
  const { draft, ready: draftReady, save: saveDraft, clear: clearDraft } = useActiveGame();
  const [draftSessionReady, setDraftSessionReady] = useState<string | null>(null);
  const completing = useRef(false);

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
    if (user && teamId && draftReady) loadData();
  }, [user, teamId, qrSessionId, qrLaneToken, draftReady]);

  useEffect(() => {
    if (!user || !mySession || draftSessionReady !== mySession.id) return;
    if (mySession.status !== "active") { void clearDraft(mySession.id).catch(() => {}); return; }
    void saveDraft({ version: 1, userId: user.id, sessionId: mySession.id, teamId: mySession.team_id,
      teamName: mySession.team_name ?? teamName ?? "Your team", lane: mySession.lane_number,
      playerBalls, lineup: sessionPlayers.map(p => p.player_user_id), updatedAt: Date.now(), previousBest: myPrevBest }).catch(() => {
      setSubmitError("Device storage is unavailable. Keep this game open until you submit your scores.");
    });
  }, [user, mySession, draftSessionReady, playerBalls, sessionPlayers, myPrevBest, saveDraft, clearDraft, teamName]);

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

      if (mySession?.status === "active" && mySession.last_activity_at && !allBallsSubmitted) {
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

    }, INACTIVITY_CHECK_MS);

    return () => clearInterval(interval);
  }, [mySession, showWarning, allBallsSubmitted]);

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
        supabase.from("team_members").select("user_id, role").eq("team_id", teamId),
        supabase.from("profiles").select("is_admin").eq("id", user!.id).single(),
      ]);
      if (sessRes.error || memRes.error) throw sessRes.error ?? memRes.error;
      setIsAdmin(profileRes.data?.is_admin === true);

      const sessions: LaneSession[] = (sessRes.data ?? []).map((s: any) => ({
        id: s.id, team_id: s.team_id, lane_number: s.lane_number, status: s.status,
        team_name: Array.isArray(s.teams) ? s.teams[0]?.name : s.teams?.name,
        last_activity_at: s.last_activity_at,
        league_match_id: s.league_match_id, placement: s.placement, league_points: s.league_points,
      }));
      setAllActiveSessions(sessions);

    const identities = await publicProfilesById((memRes.data ?? []).map((m) => m.user_id));
      const members: Member[] = (memRes.data ?? []).map((m: any) => {
        const p = identities.get(m.user_id);
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
      if (!mine && draft && draft.teamId === teamId) void clearDraft(draft.sessionId).catch(() => {});

      // Snapshot career best while the game is still active (PB celebration)
      if (user) {
        if (draft && mine && draft.sessionId === mine.id) setMyPrevBest(draft.previousBest);
        else fetchPlayerStats(user.id).then((st) => setMyPrevBest(st?.totals.best ?? null));
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
    if (playersRes.error || scoresRes.error) throw playersRes.error ?? scoresRes.error;

    const players: SessionPlayer[] = (playersRes.data ?? [])
      .map((p: any) => {
        const m = mems.find((x) => x.user_id === p.player_user_id);
        return { ...p, shoot_position: p.shoot_position ?? null, username: m?.username ?? "Unknown", avatar_url: m?.avatar_url ?? null };
      })
      .sort((a: SessionPlayer, b: SessionPlayer) => (a.shoot_position ?? 99) - (b.shoot_position ?? 99) || a.player_user_id.localeCompare(b.player_user_id));
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
    setPlayerBalls(restoreBalls(initialBalls, draft, sessionId));
    setDraftSessionReady(sessionId);
    // Realtime for this session's ball scores
    if (channelRef.current) channelRef.current.unsubscribe();
    channelRef.current = supabase
      .channel(`skeeball_session_${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "skeeball_sessions", filter: `id=eq.${sessionId}` }, (payload: any) => {
        if (payload.new?.status) {
          if (payload.new.status === "abandoned") {
            void clearDraft(sessionId).catch(() => {});
            setMySession(null);
            setDraftSessionReady(null);
            setPlayerBalls({});
            showToast("This lane session has ended. Check in again to start a new game.", "info");
          } else setMySession((prev) => prev ? { ...prev, ...payload.new } : prev);
        }
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
      const { data: matchData, error: matchError } = await supabase.rpc("rpc_skeeball_get_or_create_match", {
        p_week_of: getMondayDate(),
      });
      if (matchError || !matchData?.match_id) throw new Error(matchError?.message ?? matchData?.message ?? "Could not start the league match.");
      const matchId: string = matchData.match_id;

      const { data: session, error: sErr } = await supabase
        .from("skeeball_sessions")
        .insert({ team_id: teamId, lane_number: selectedLane, week_of: getMondayDate(), created_by: user.id, status: "active", last_activity_at: new Date().toISOString(), league_match_id: matchId })
        .select()
        .single();
      if (sErr) throw sErr;

      const { error: pErr } = await supabase
        .from("skeeball_session_players")
        .insert(selectedPlayers.map((pid, index) => ({ session_id: session.id, player_user_id: pid, shoot_position: index + 1 })));
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
    const balls = sessionPlayers.flatMap((sp) =>
      (playerBalls[sp.player_user_id] ?? []).map((score, i) => ({
        player_user_id: sp.player_user_id,
        ball_number: i + 1,
        score,
      }))
    );
    try {
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
      haptic("success");
    } catch (e: any) {
      // Dropped connection mid-submit: stash the game and flush automatically
      // when we're back online, instead of losing the scores.
      if (looksOffline(e)) {
        try {
          await queueSubmit(user.id, { session_id: mySession!.id, balls });
        } catch {
          setSubmitError("Could not save scores on this device. Keep this screen open and try again.");
          return;
        }
        haptic("warning");
        showToast("You're offline — scores saved, will submit automatically", "success");
        goBack();
        return;
      }
      const msg = e?.message ?? "Failed to submit scores";
      reportError("SkeeballTracker.submitBalls", msg);
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const lastTouch = useRef(0);
  function addBall(pts: number) {
    if (Date.now() - lastTouch.current > 20_000) { lastTouch.current = Date.now(); void stayActive(); }
    haptic(pts >= 50 ? "success" : "tap");
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
    haptic("light");
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
    const { error } = await supabase.from("skeeball_sessions").update({ last_activity_at: now }).eq("id", mySession.id).eq("status", "active");
    if (error) return;
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
    if (!user) return;
    const queued = await pendingSubmissions(user.id).catch(() => null);
    if (!queued || queued.some(item => item.session_id === sessionId)) return;
    const latest = await supabase.from("skeeball_sessions")
      .select("status, last_activity_at, skeeball_ball_scores(id)").eq("id", sessionId).maybeSingle();
    if (latest.error || !latest.data || latest.data.status !== "active") return;
    const lastActivity = latest.data.last_activity_at;
    if (!lastActivity || latest.data.skeeball_ball_scores?.length >= TOTAL_BALLS) return;
    if (Date.now() - new Date(lastActivity).getTime() < INACTIVITY_TIMEOUT_MS) {
      setMySession(prev => prev?.id === sessionId ? { ...prev, last_activity_at: lastActivity } : prev);
      setShowWarning(false);
      return;
    }
    const { data, error } = await supabase
      .from("skeeball_sessions")
      .update({ status: "abandoned" })
      .eq("id", sessionId)
      .eq("status", "active")
      .eq("last_activity_at", lastActivity)
      .select("id");
    if (error || !data?.length) { setSubmitError("Could not release the lane. Please retry when connected."); return; }
    await clearDraft(sessionId).catch(() => {});
    setMySession(null);
    setSessionPlayers([]);
    setBallScores([]);
    setAllActiveSessions((prev) => prev.filter((s) => s.id !== sessionId));
  }

  async function completeSession() {
    if (!mySession || mySession.status !== "active" || completing.current) return;
    completing.current = true;
    setSubmitError(null);
    try {
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
    } catch {
      setSubmitError("Could not finalize the game. Your submitted scores are saved; try again.");
    } finally { completing.current = false; }
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
        const { data, error } = await supabase.rpc("rpc_skeeball_cancel_session", { p_session_id: mySession.id, p_force: force });
        if (error || data?.error || data?.ok !== true) throw new Error(error?.message ?? data?.message ?? "Game was not ended");
        if (user) await discardQueuedSubmission(user.id, mySession.id);
        await clearDraft(mySession.id);
      } catch {
        showToast("Could not end the game. Your scores are still here; try again.", "error");
        return;
      }
    }
    leaveScreen();
  }

  // Android hardware back saves the draft just like the visible Back control.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { goBack(); return true; });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySession, playerBalls, ballScores, sessionPlayers]);

  // Leaving the scorer preserves the lane and draft; ending a game is explicit.
  async function goBack() {
    if (mySession?.status === "active" && user && draftSessionReady === mySession.id) {
      try {
        await saveDraft({ version: 1, userId: user.id, sessionId: mySession.id, teamId: mySession.team_id,
          teamName: mySession.team_name ?? teamName ?? "Your team", lane: mySession.lane_number,
          playerBalls, lineup: sessionPlayers.map(p => p.player_user_id), updatedAt: Date.now(), previousBest: myPrevBest });
      } catch { showToast("Could not save on this device. Keep the game open and retry.", "error"); return; }
    }
    leaveScreen();
  }

  function endGame() {
    if (mySession?.status === "active") {
      const enteredLocal = sessionPlayers.reduce(
        (s, sp) => s + (playerBalls[sp.player_user_id] ?? []).length, 0
      );
      const entered = enteredLocal + ballScores.length;
      if (entered > 0) {
        Alert.alert(
          "Discard this game?",
          `End the game on Lane ${mySession.lane_number}? This releases the lane and discards the unfinished scores. Use Back to save and resume instead.`,
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
        <View style={s.topBar}><Pressable accessibilityRole="button" accessibilityLabel="Save and go back" style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable></View>
        <View style={s.centered}><ActivityIndicator size="large" color="#06b6d4" /></View>
      </SafeAreaView>
    );
  }

  // ─── Not Monday (admins and QR sessions can always access) ───────────────────

  if (!isMonday() && !isAdmin && !cameFromQr) {
    return (
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        <View style={s.topBar}><Pressable accessibilityRole="button" accessibilityLabel="Save and go back" style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable></View>
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
    return <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <SessionFinish userId={user?.id} previousBest={myPrevBest} placement={mySession?.placement} leaguePoints={mySession?.league_points}
        players={sessionPlayers.map(sp => ({ id: sp.player_user_id, name: sp.username, score: ballScores.filter(b => b.player_user_id === sp.player_user_id).reduce((sum, b) => sum + b.score, 0) }))}
        onDone={leaveScreen} />
    </SafeAreaView>;
  }

  if (mySession && iAmPlayer && allBallsSubmitted) {
    return (
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        {warningModal}
        <View style={s.topBar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Save and go back" style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
          <Text style={s.topBarTitle}>Lane {mySession.lane_number}</Text>
          <Pressable accessibilityRole="button" style={{ minHeight: 44, minWidth: 84, alignItems: "center", justifyContent: "center" }} onPress={endGame}><Text style={{ color: "#fca5a5", fontWeight: "700" }}>End game</Text></Pressable>
        </View>
        <View style={s.centered}>
          <View style={s.waitWrap}><ActivityIndicator size="large" color="#06b6d4" /></View>
          <Text style={s.bigTitle}>Scores Submitted!</Text>
          <Text style={s.bigSub}>Finalizing results…</Text>
          {submitError && <>
            <Text style={{ color: "#fca5a5", marginTop: 16, textAlign: "center" }}>{submitError}</Text>
            <Pressable accessibilityRole="button" style={s.doneBtn} onPress={completeSession}><Text style={s.doneBtnText}>Retry finalizing</Text></Pressable>
          </>}
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
          <Pressable accessibilityRole="button" accessibilityLabel="Save and go back" style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
          <Text style={s.topBarTitle}>Lane {mySession.lane_number}</Text>
          <Pressable accessibilityRole="button" style={{ minHeight: 44, minWidth: 84, alignItems: "center", justifyContent: "center" }} onPress={endGame}><Text style={{ color: "#fca5a5", fontWeight: "700" }}>End game</Text></Pressable>
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
          <Pressable accessibilityRole="button" accessibilityLabel="Save and go back" style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
          <Text style={s.topBarTitle}>Lane {mySession.lane_number}</Text>
          <Pressable accessibilityRole="button" style={{ minHeight: 44, minWidth: 84, alignItems: "center", justifyContent: "center" }} onPress={endGame}><Text style={{ color: "#fca5a5", fontWeight: "700" }}>End game</Text></Pressable>
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
                    accessibilityLabel={`Move ${sp.username} earlier in the lineup`}
                    onPress={() => moveInOrder(idx, -1)}
                    disabled={idx === 0 || savingOrder}
                    hitSlop={6}
                  >
                    <Ionicons name="chevron-up" size={17} color="#06b6d4" />
                  </Pressable>
                  <Pressable
                    style={[s.orderArrow, idx === sessionPlayers.length - 1 && { opacity: 0.25 }]}
                    accessibilityLabel={`Move ${sp.username} later in the lineup`}
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
        <Pressable accessibilityRole="button" accessibilityLabel="Save and go back" style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
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
                  <Text style={[s.laneBtnNum, sel && { color: "#000" }, taken && { color: "#a3adb8" }]}>{lane}</Text>
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
  bigSub: { color: "#a3adb8", fontSize: 14, textAlign: "center" },

  sectionLabel: { color: "#a3adb8", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 12 },
  spectatorNote: { color: "#a3adb8", fontSize: 14, textAlign: "center", marginBottom: 24 },

  trophyWrap: { width: 96, height: 96, borderRadius: 48, backgroundColor: "rgba(245,158,11,0.1)", alignItems: "center", justifyContent: "center", marginBottom: 24, borderWidth: 1, borderColor: "rgba(245,158,11,0.25)" },
  placementBadge: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#111", borderRadius: 16, paddingHorizontal: 20, paddingVertical: 14, borderWidth: 1, marginTop: 4, marginBottom: 4 },
  placementEmoji: { fontSize: 32 },
  placementLabel: { fontSize: 20, fontWeight: "900" },
  placementPts: { color: "#a3adb8", fontSize: 13, fontWeight: "600", marginTop: 2 },
  waitWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(6,182,212,0.1)", alignItems: "center", justifyContent: "center", marginBottom: 24 },

  resultCard: { width: "100%", backgroundColor: "#111", borderRadius: 20, padding: 20, marginTop: 24, borderWidth: 1, borderColor: "#1a1a1a" },
  resultRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  resultName: { color: "#fff", fontSize: 15, fontWeight: "800" },
  resultBalls: { color: "#a3adb8", fontSize: 12, marginTop: 2 },
  resultTotal: { color: "#06b6d4", fontSize: 22, fontWeight: "900" },
  resultDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#2a2a2a", marginVertical: 12 },
  resultTotalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  resultTotalLabel: { color: "#a3adb8", fontSize: 14, fontWeight: "700" },
  resultTotalValue: { color: "#22c55e", fontSize: 28, fontWeight: "900" },

  recapBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderColor: "rgba(6,182,212,0.4)", borderWidth: 1, borderRadius: 18,
    paddingHorizontal: 32, paddingVertical: 14, marginTop: 28,
  },
  recapBtnText: { color: "#06b6d4", fontWeight: "800", fontSize: 15 },
  doneBtn: { backgroundColor: "#06b6d4", borderRadius: 18, paddingHorizontal: 32, paddingVertical: 16, marginTop: 12 },
  doneBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },

  laneChip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(6,182,212,0.1)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, alignSelf: "flex-start", marginBottom: 20, borderWidth: 1, borderColor: "rgba(6,182,212,0.2)" },
  laneChipText: { color: "#06b6d4", fontWeight: "800", fontSize: 14 },
  scoreTitle: { color: "#fff", fontSize: 22, fontWeight: "900", marginBottom: 6 },
  scoreSub: { color: "#a3adb8", fontSize: 13, marginBottom: 24 },

  orderCard: {
    backgroundColor: "rgba(6,182,212,0.04)", borderRadius: 16, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.18)",
  },
  orderHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 4 },
  orderTitle: { color: "#fff", fontSize: 14, fontWeight: "800", flex: 1 },
  orderHint: { color: "#a3adb8", fontSize: 11.5, lineHeight: 16, marginBottom: 10 },
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
  pbSub: { color: "#a3adb8", fontSize: 12.5, marginTop: 2 },

  playerSection: { backgroundColor: "#111", borderRadius: 16, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: "#1a1a1a" },
  playerSectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  playerSectionName: { color: "#fff", fontSize: 14, fontWeight: "800", flex: 1 },
  playerSectionTotal: { color: "#06b6d4", fontSize: 16, fontWeight: "900" },

  ballRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#0d0d0d", borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#1a1a1a", gap: 12 },
  ballLabel: { color: "#a3adb8", fontSize: 14, fontWeight: "700", width: 48 },
  ballInput: { flex: 1, color: "#fff", fontSize: 28, fontWeight: "900", textAlign: "center" },
  ballUnit: { color: "#a3adb8", fontSize: 13, fontWeight: "700", width: 28, textAlign: "right" },
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
  totalLabel: { color: "#a3adb8", fontSize: 14 },
  totalValue: { color: "#06b6d4", fontSize: 22, fontWeight: "900" },

  submitBtn: { backgroundColor: "#06b6d4", borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 18, marginBottom: 12 },
  submitBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
  btnOff: { backgroundColor: "#141414" },

  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },

  memberRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#111", borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#1a1a1a" },
  memberRowSel: { backgroundColor: "rgba(6,182,212,0.08)", borderColor: "rgba(6,182,212,0.3)" },
  memberRowDim: { opacity: 0.4 },
  memberName: { color: "#a3adb8", fontSize: 15, fontWeight: "700" },
  capLabel: { color: "#f59e0b", fontSize: 11, fontWeight: "700", marginTop: 2 },
  checkbox: { width: 26, height: 26, borderRadius: 8, backgroundColor: "#1a1a1a", borderWidth: 1.5, borderColor: "#2a2a2a", alignItems: "center", justifyContent: "center" },
  checkboxSel: { backgroundColor: "#06b6d4", borderColor: "#06b6d4" },

  laneGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 28 },
  laneBtn: { width: "31%", height: 72, backgroundColor: "#111", borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#1a1a1a", gap: 2, paddingHorizontal: 6 },
  laneBtnSel: { backgroundColor: "#06b6d4", borderColor: "#06b6d4" },
  laneBtnTaken: { backgroundColor: "#0d0d0d", borderColor: "#1a1a1a" },
  laneBtnNum: { color: "#fff", fontSize: 22, fontWeight: "900" },
  laneBtnStatus: { color: "#a3adb8", fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  laneTeamName: { color: "#a3adb8", fontSize: 10, textAlign: "center", paddingHorizontal: 2 },

  progressRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  progressCard: { backgroundColor: "#111", borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#1a1a1a", borderBottomWidth: 0 },
  progressName: { color: "#fff", fontSize: 14, fontWeight: "800" },
  progressSub: { color: "#a3adb8", fontSize: 12, marginTop: 1 },
  youChip: { backgroundColor: "rgba(6,182,212,0.12)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  youChipText: { color: "#06b6d4", fontSize: 10, fontWeight: "900" },
  ballDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#1e1e1e", borderWidth: 1, borderColor: "#2a2a2a" },
  ballDotFilled: { backgroundColor: "#22c55e", borderColor: "#22c55e" },

  kickBtn: { position: "absolute", top: 4, right: 4, padding: 2 },

  // Ring-tap scoring
  ringHint: { color: "#a3adb8", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },
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
  undoText: { color: "#a3adb8", fontSize: 12 },

  completeRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4 },
  completeText: { color: "#22c55e", fontSize: 14, fontWeight: "800" },
  playerSectionDim: { opacity: 0.5 },
  upNextText: { color: "#a3adb8", fontSize: 12, fontStyle: "italic", paddingTop: 4 },

  warningOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 32 },
  warningCard: { width: "100%", backgroundColor: "#111", borderRadius: 24, padding: 28, alignItems: "center", borderWidth: 1.5, borderColor: "rgba(239,68,68,0.4)" },
  warningIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(239,68,68,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 20, borderWidth: 1, borderColor: "rgba(239,68,68,0.3)" },
  warningTitle: { color: "#ef4444", fontSize: 22, fontWeight: "900", marginBottom: 10, textAlign: "center" },
  warningSub: { color: "#7a7a7a", fontSize: 14, textAlign: "center", marginBottom: 16, lineHeight: 20 },
  warningCountdown: { color: "#ef4444", fontSize: 56, fontWeight: "900", letterSpacing: 2, marginBottom: 28 },
  warningBtn: { backgroundColor: "#06b6d4", borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, paddingHorizontal: 32 },
  warningBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
});
