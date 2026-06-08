import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/avatar";
import { supabase } from "../../lib/supabase";
import { useRequireAuth } from "../hooks/use-require-auth";

const LANE_COUNT = 6;
const BALLS_PER_PLAYER = 3;
const PLAYERS_PER_GAME = 3;
const MIN_PLAYERS = 1;
const INACTIVITY_WARNING_MS  = 8 * 60 * 1000;  // show warning after 8 min
const INACTIVITY_TIMEOUT_MS  = 10 * 60 * 1000; // abandon after 10 min
const INACTIVITY_CHECK_MS    = 30 * 1000;       // check every 30 seconds
const WARNING_DURATION_S     = 120;             // 2-minute countdown

type LaneSession = { id: string; team_id: string; lane_number: number; status: string; team_name?: string; last_activity_at?: string };
type SessionPlayer = { session_id: string; player_user_id: string; username: string; avatar_url: string | null };
type BallScore = { id: string; session_id: string; player_user_id: string; ball_number: number; score: number };
type Member = { user_id: string; username: string; avatar_url: string | null; role: string };

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

export default function SkeeballTrackerScreen() {
  const { teamId, teamName } = useLocalSearchParams<{ teamId: string; teamName: string }>();
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

  // Scoring state
  const [balls, setBalls] = useState(["", "", ""]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Inactivity warning
  const [showWarning, setShowWarning] = useState(false);
  const [warningCountdown, setWarningCountdown] = useState(WARNING_DURATION_S);

  const channelRef = useRef<any>(null);

  const iAmPlayer = sessionPlayers.some((p) => p.player_user_id === user?.id);
  const myBalls = ballScores.filter((b) => b.player_user_id === user?.id);
  const myBallsSubmitted = myBalls.length >= BALLS_PER_PLAYER;
  const sessionDone = mySession?.status === "completed";
  const takenLanes = new Set(allActiveSessions.map((s) => s.lane_number));

  const playerProgress = sessionPlayers.map((sp) => ({
    ...sp,
    balls: ballScores.filter((b) => b.player_user_id === sp.player_user_id).length,
  }));

  useEffect(() => {
    if (user && teamId) loadData();
  }, [user, teamId]);

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

        const mine = sessions.find((s) => s.team_id === teamId);
        if (mine && !mySession) {
          setMySession(mine);
          await loadSessionData(mine.id);
        }
      })
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [teamId, mySession]);

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

  // Auto-complete when all 9 balls submitted
  useEffect(() => {
    if (!mySession || mySession.status !== "active" || sessionPlayers.length < PLAYERS_PER_GAME) return;
    const allIn = sessionPlayers.every(
      (sp) => ballScores.filter((b) => b.player_user_id === sp.player_user_id).length >= BALLS_PER_PLAYER
    );
    if (allIn) completeSession();
  }, [ballScores, sessionPlayers, mySession]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [sessRes, memRes, profileRes] = await Promise.all([
        supabase.from("skeeball_sessions").select("id, team_id, lane_number, status, last_activity_at, teams(name)").eq("status", "active"),
        supabase.from("team_members").select("user_id, role, profiles(username, avatar_url)").eq("team_id", teamId),
        supabase.from("profiles").select("is_admin").eq("id", user!.id).single(),
      ]);
      setIsAdmin(profileRes.data?.is_admin === true);

      const sessions: LaneSession[] = (sessRes.data ?? []).map((s: any) => ({
        id: s.id, team_id: s.team_id, lane_number: s.lane_number, status: s.status,
        team_name: Array.isArray(s.teams) ? s.teams[0]?.name : s.teams?.name,
        last_activity_at: s.last_activity_at,
      }));
      setAllActiveSessions(sessions);

      const members: Member[] = (memRes.data ?? []).map((m: any) => {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
        return { user_id: m.user_id, role: m.role, username: p?.username ?? "Unknown", avatar_url: p?.avatar_url ?? null };
      });
      setTeamMembers(members);

      const mine = sessions.find((s) => s.team_id === teamId) ?? null;
      setMySession(mine);

      if (mine) await loadSessionData(mine.id, members);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function loadSessionData(sessionId: string, members?: Member[]) {
    const mems = members ?? teamMembers;
    const [playersRes, scoresRes] = await Promise.all([
      supabase.from("skeeball_session_players").select("session_id, player_user_id").eq("session_id", sessionId),
      supabase.from("skeeball_ball_scores").select("*").eq("session_id", sessionId),
    ]);

    const players: SessionPlayer[] = (playersRes.data ?? []).map((p: any) => {
      const m = mems.find((x) => x.user_id === p.player_user_id);
      return { ...p, username: m?.username ?? "Unknown", avatar_url: m?.avatar_url ?? null };
    });
    setSessionPlayers(players);
    setBallScores(scoresRes.data ?? []);

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
      const { data: session, error: sErr } = await supabase
        .from("skeeball_sessions")
        .insert({ team_id: teamId, lane_number: selectedLane, week_of: getMondayDate(), created_by: user.id, status: "active", last_activity_at: new Date().toISOString() })
        .select()
        .single();
      if (sErr) throw sErr;

      const { error: pErr } = await supabase
        .from("skeeball_session_players")
        .insert(selectedPlayers.map((pid) => ({ session_id: session.id, player_user_id: pid })));
      if (pErr) throw pErr;

      const newSession: LaneSession = { id: session.id, team_id: teamId, lane_number: selectedLane, status: "active", last_activity_at: new Date().toISOString() };
      setMySession(newSession);
      await loadSessionData(session.id);
    } catch (e: any) {
      setError(e?.message ?? "Failed to start game");
    } finally {
      setStarting(false);
    }
  }

  async function submitBalls() {
    if (!user || !mySession) return;
    const parsed = balls.map((b) => parseInt(b) || 0);
    if (balls.some((b) => b === "")) { setSubmitError("Enter a score for each ball."); return; }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const inserts = parsed.map((score, i) => ({
        session_id: mySession.id, player_user_id: user.id, ball_number: i + 1, score,
      }));
      const { error } = await supabase
        .from("skeeball_ball_scores")
        .upsert(inserts, { onConflict: "session_id,player_user_id,ball_number" });
      if (error) throw error;

      // Reset inactivity timer and dismiss any warning
      const now = new Date().toISOString();
      await supabase.from("skeeball_sessions").update({ last_activity_at: now }).eq("id", mySession.id);
      setMySession((prev) => prev ? { ...prev, last_activity_at: now } : prev);
      setShowWarning(false);
      setWarningCountdown(WARNING_DURATION_S);

      setBallScores((prev) => [
        ...prev.filter((b) => b.player_user_id !== user.id),
        ...inserts.map((ins, i) => ({ ...ins, id: `local_${i}` })),
      ]);
    } catch (e: any) {
      setSubmitError(e?.message ?? "Failed to submit scores");
    } finally {
      setSubmitting(false);
    }
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

    const { data: updated } = await supabase
      .from("skeeball_sessions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", mySession.id).eq("status", "active")
      .select().single();
    if (!updated) return; // another client already completed it

    const { data: game } = await supabase.from("games").select("id").eq("type", "skeeball").maybeSingle();
    if (game?.id) {
      await supabase.from("scores").insert(
        sessionPlayers.map((sp) => {
          const total = ballScores.filter((b) => b.player_user_id === sp.player_user_id).reduce((s, b) => s + b.score, 0);
          return { user_id: sp.player_user_id, game_id: game.id, score: total, status: "pending" };
        })
      );
    }
    setMySession((prev) => prev ? { ...prev, status: "completed" } : prev);
  }

  function togglePlayer(uid: string) {
    setSelectedPlayers((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : prev.length < PLAYERS_PER_GAME ? [...prev, uid] : prev
    );
  }

  function goBack() {
    router.canGoBack() ? router.back() : router.replace("/teams" as any);
  }

  // ─── Not Monday ───────────────────────────────────────────────────────────────

  if (!isMonday()) {
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

  // ─── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.topBar}><Pressable style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable></View>
        <View style={s.centered}><ActivityIndicator size="large" color="#06b6d4" /></View>
      </SafeAreaView>
    );
  }

  // ─── Complete ─────────────────────────────────────────────────────────────────

  if (sessionDone) {
    const teamTotal = sessionPlayers.reduce((sum, sp) => sum + ballScores.filter((b) => b.player_user_id === sp.player_user_id).reduce((s, b) => s + b.score, 0), 0);
    return (
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        <View style={s.topBar}><Pressable style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable></View>
        <View style={s.centered}>
          <View style={s.trophyWrap}><Ionicons name="trophy" size={48} color="#f59e0b" /></View>
          <Text style={s.bigTitle}>Game Complete!</Text>
          <Text style={s.bigSub}>Scores submitted for review.</Text>
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

  if (mySession && iAmPlayer && myBallsSubmitted) {
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
          <Text style={s.bigSub}>Waiting for teammates…</Text>
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

  // ─── Scoring (my turn) ────────────────────────────────────────────────────────

  if (mySession && iAmPlayer && !myBallsSubmitted) {
    const ballTotal = balls.reduce((sum, b) => sum + (parseInt(b) || 0), 0);
    return (
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        {warningModal}
        <View style={s.topBar}>
          <Pressable style={s.iconBtn} onPress={goBack}><Ionicons name="chevron-back" size={22} color="#fff" /></Pressable>
          <Text style={s.topBarTitle}>Lane {mySession.lane_number}</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.laneChip}>
            <Ionicons name="location" size={15} color="#06b6d4" />
            <Text style={s.laneChipText}>Lane {mySession.lane_number}</Text>
          </View>
          <Text style={s.scoreTitle}>Enter Your Ball Scores</Text>
          <Text style={s.scoreSub}>Enter the score for each of your 3 balls</Text>

          {[0, 1, 2].map((i) => (
            <View key={i} style={s.ballRow}>
              <Text style={s.ballLabel}>Ball {i + 1}</Text>
              <TextInput
                style={s.ballInput}
                value={balls[i]}
                onChangeText={(v) => { const n = [...balls]; n[i] = v.replace(/[^0-9]/g, ""); setBalls(n); }}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor="#333"
                maxLength={3}
              />
              <Text style={s.ballUnit}>pts</Text>
            </View>
          ))}

          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Your total</Text>
            <Text style={s.totalValue}>{ballTotal} pts</Text>
          </View>

          {submitError && (
            <View style={s.errorBox}>
              <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
              <Text style={s.errorText}>{submitError}</Text>
            </View>
          )}

          <Pressable
            style={[s.submitBtn, (submitting || balls.some((b) => b === "")) && s.btnOff]}
            onPress={submitBalls}
            disabled={submitting || balls.some((b) => b === "")}
          >
            {submitting ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="checkmark-circle-outline" size={20} color="#000" />}
            <Text style={s.submitBtnText}>Submit My Scores</Text>
          </Pressable>

          <Text style={[s.sectionLabel, { marginTop: 28 }]}>Team Progress</Text>
          {playerProgress.map((pp) => (
            <ProgressRow key={pp.player_user_id} pp={pp} isMe={pp.player_user_id === user?.id} card />
          ))}
        </ScrollView>
      </SafeAreaView>
    );
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

function ProgressRow({ pp, isMe, card }: { pp: { player_user_id: string; username: string; avatar_url: string | null; balls: number }; isMe: boolean; card?: boolean }) {
  const done = pp.balls >= BALLS_PER_PLAYER;
  return (
    <View style={[s.progressRow, card && s.progressCard]}>
      <Avatar uri={pp.avatar_url} name={pp.username} size={36} radius={11} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={s.progressName}>{pp.username}</Text>
          {isMe && <View style={s.youChip}><Text style={s.youChipText}>You</Text></View>}
        </View>
        <Text style={s.progressSub}>{pp.balls}/{BALLS_PER_PLAYER} balls submitted</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
        {Array.from({ length: BALLS_PER_PLAYER }, (_, i) => (
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
  bigSub: { color: "#555", fontSize: 14, textAlign: "center" },

  sectionLabel: { color: "#444", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 12 },
  spectatorNote: { color: "#555", fontSize: 14, textAlign: "center", marginBottom: 24 },

  trophyWrap: { width: 96, height: 96, borderRadius: 48, backgroundColor: "rgba(245,158,11,0.1)", alignItems: "center", justifyContent: "center", marginBottom: 24, borderWidth: 1, borderColor: "rgba(245,158,11,0.25)" },
  waitWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(6,182,212,0.1)", alignItems: "center", justifyContent: "center", marginBottom: 24 },

  resultCard: { width: "100%", backgroundColor: "#111", borderRadius: 20, padding: 20, marginTop: 24, borderWidth: 1, borderColor: "#1e1e1e" },
  resultRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  resultName: { color: "#fff", fontSize: 15, fontWeight: "800" },
  resultBalls: { color: "#444", fontSize: 12, marginTop: 2 },
  resultTotal: { color: "#06b6d4", fontSize: 22, fontWeight: "900" },
  resultDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#2a2a2a", marginVertical: 12 },
  resultTotalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  resultTotalLabel: { color: "#555", fontSize: 14, fontWeight: "700" },
  resultTotalValue: { color: "#22c55e", fontSize: 28, fontWeight: "900" },

  doneBtn: { backgroundColor: "#06b6d4", borderRadius: 18, paddingHorizontal: 32, paddingVertical: 16, marginTop: 32 },
  doneBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },

  laneChip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(6,182,212,0.1)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, alignSelf: "flex-start", marginBottom: 20, borderWidth: 1, borderColor: "rgba(6,182,212,0.2)" },
  laneChipText: { color: "#06b6d4", fontWeight: "800", fontSize: 14 },
  scoreTitle: { color: "#fff", fontSize: 22, fontWeight: "900", marginBottom: 6 },
  scoreSub: { color: "#555", fontSize: 13, marginBottom: 24 },

  ballRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#111", borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: "#1e1e1e", gap: 12 },
  ballLabel: { color: "#555", fontSize: 14, fontWeight: "700", width: 48 },
  ballInput: { flex: 1, color: "#fff", fontSize: 28, fontWeight: "900", textAlign: "center" },
  ballUnit: { color: "#333", fontSize: 13, fontWeight: "700", width: 28, textAlign: "right" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#0d0d0d", borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: "#1a1a1a" },
  totalLabel: { color: "#555", fontSize: 14 },
  totalValue: { color: "#06b6d4", fontSize: 22, fontWeight: "900" },

  submitBtn: { backgroundColor: "#06b6d4", borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 18, marginBottom: 12 },
  submitBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
  btnOff: { backgroundColor: "#141414" },

  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },

  memberRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#111", borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#1e1e1e" },
  memberRowSel: { backgroundColor: "rgba(6,182,212,0.08)", borderColor: "rgba(6,182,212,0.3)" },
  memberRowDim: { opacity: 0.4 },
  memberName: { color: "#777", fontSize: 15, fontWeight: "700" },
  capLabel: { color: "#f59e0b", fontSize: 11, fontWeight: "700", marginTop: 2 },
  checkbox: { width: 26, height: 26, borderRadius: 8, backgroundColor: "#1a1a1a", borderWidth: 1.5, borderColor: "#2a2a2a", alignItems: "center", justifyContent: "center" },
  checkboxSel: { backgroundColor: "#06b6d4", borderColor: "#06b6d4" },

  laneGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 28 },
  laneBtn: { width: "31%", height: 72, backgroundColor: "#111", borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#1e1e1e", gap: 2, paddingHorizontal: 6 },
  laneBtnSel: { backgroundColor: "#06b6d4", borderColor: "#06b6d4" },
  laneBtnTaken: { backgroundColor: "#0d0d0d", borderColor: "#1e1e1e" },
  laneBtnNum: { color: "#fff", fontSize: 22, fontWeight: "900" },
  laneBtnStatus: { color: "#444", fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  laneTeamName: { color: "#555", fontSize: 10, textAlign: "center", paddingHorizontal: 2 },

  progressRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  progressCard: { backgroundColor: "#111", borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#1e1e1e", borderBottomWidth: 0 },
  progressName: { color: "#fff", fontSize: 14, fontWeight: "800" },
  progressSub: { color: "#444", fontSize: 12, marginTop: 1 },
  youChip: { backgroundColor: "rgba(6,182,212,0.12)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  youChipText: { color: "#06b6d4", fontSize: 10, fontWeight: "900" },
  ballDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#1e1e1e", borderWidth: 1, borderColor: "#2a2a2a" },
  ballDotFilled: { backgroundColor: "#22c55e", borderColor: "#22c55e" },

  kickBtn: { position: "absolute", top: 4, right: 4, padding: 2 },

  warningOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 32 },
  warningCard: { width: "100%", backgroundColor: "#111", borderRadius: 24, padding: 28, alignItems: "center", borderWidth: 1.5, borderColor: "rgba(239,68,68,0.4)" },
  warningIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(239,68,68,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 20, borderWidth: 1, borderColor: "rgba(239,68,68,0.3)" },
  warningTitle: { color: "#ef4444", fontSize: 22, fontWeight: "900", marginBottom: 10, textAlign: "center" },
  warningSub: { color: "#666", fontSize: 14, textAlign: "center", marginBottom: 16, lineHeight: 20 },
  warningCountdown: { color: "#ef4444", fontSize: 56, fontWeight: "900", letterSpacing: 2, marginBottom: 28 },
  warningBtn: { backgroundColor: "#06b6d4", borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, paddingHorizontal: 32 },
  warningBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
});
