import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Head from "expo-router/head";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

const CONFETTI_COLORS = ["#06b6d4", "#f59e0b", "#22c55e", "#a855f7", "#ef4444", "#fff"];

/** Lightweight confetti burst — pure Animated views, fires once per mount. */
function ConfettiBurst() {
  const { width, height } = useWindowDimensions();
  const pieces = useRef(
    Array.from({ length: 28 }, (_, i) => ({
      x: Math.random() * width,
      drift: (Math.random() - 0.5) * 120,
      size: 6 + Math.random() * 7,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 500,
      anim: new Animated.Value(0),
      spin: Math.random() > 0.5 ? "360deg" : "-360deg",
    })),
  ).current;

  useEffect(() => {
    pieces.forEach((p) => {
      Animated.timing(p.anim, {
        toValue: 1,
        duration: 2200 + Math.random() * 800,
        delay: p.delay,
        useNativeDriver: true,
      }).start();
    });
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute",
            left: p.x,
            top: -20,
            width: p.size,
            height: p.size * 1.6,
            borderRadius: 2,
            backgroundColor: p.color,
            opacity: p.anim.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateY: p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, height + 40] }) },
              { translateX: p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
              { rotate: p.anim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", p.spin] }) },
            ],
          }}
        />
      ))}
    </View>
  );
}

const TOTAL_BALLS = 9;

type LiveSession = {
  id: string;
  team_id: string;
  team_name: string;
  lane_number: number;
  status: string;
  placement: number | null;
  league_points: number | null;
};

type LiveBall = { session_id: string; player_user_id: string; ball_number: number; score: number };

function currentMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export default function SkeeballLiveScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [balls, setBalls] = useState<LiveBall[]>([]);
  const [expected, setExpected] = useState(4);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const channelsRef = useRef<any[]>([]);
  // TV / auto-cycle dashboard
  const [season, setSeason] = useState<{ team_name: string; total_points: number; gold: number; silver: number; bronze: number }[]>([]);
  const [tvMode, setTvMode] = useState(false);
  const [panel, setPanel] = useState<0 | 1>(0); // 0 = tonight, 1 = season

  async function load() {
    const week = currentMonday();
    const { data: matches } = await supabase
      .from("skeeball_league_matches")
      .select("id, status, expected_teams")
      .eq("week_of", week)
      .order("created_at", { ascending: false });

    // Season standings (for the auto-cycling TV dashboard)
    supabase.from("skeeball_league_standings")
      .select("team_name, total_points, gold, silver, bronze")
      .order("total_points", { ascending: false }).limit(12)
      .then(({ data }) => setSeason((data ?? []) as any));

    const open = (matches ?? []).find((m: any) => (m.status ?? "active") !== "completed")
      ?? (matches ?? [])[0];
    if (!open) {
      setSessions([]);
      setBalls([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setExpected(open.expected_teams ?? 4);

    const { data: sessData } = await supabase
      .from("skeeball_sessions")
      .select("id, team_id, lane_number, status, placement, league_points, teams(name)")
      .eq("league_match_id", open.id)
      .neq("status", "abandoned")
      .order("lane_number");

    const live: LiveSession[] = (sessData ?? []).map((s: any) => ({
      id: s.id,
      team_id: s.team_id,
      team_name: (Array.isArray(s.teams) ? s.teams[0]?.name : s.teams?.name) ?? "Unknown",
      lane_number: s.lane_number,
      status: s.status,
      placement: s.placement,
      league_points: s.league_points,
    }));
    setSessions(live);

    const ids = live.map((s) => s.id);
    if (ids.length) {
      const { data: ballData } = await supabase
        .from("skeeball_ball_scores")
        .select("session_id, player_user_id, ball_number, score")
        .in("session_id", ids);
      setBalls((ballData ?? []) as LiveBall[]);
    } else {
      setBalls([]);
    }

    // Realtime: one channel per session for new balls + status flips
    channelsRef.current.forEach((c) => c.unsubscribe());
    channelsRef.current = ids.map((sid) =>
      supabase
        .channel(`skee_live_${sid}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "skeeball_ball_scores", filter: `session_id=eq.${sid}` }, (payload: any) => {
          setBalls((prev) => [
            // Replace any existing row for the same ball (upserts re-fire)
            ...prev.filter((b) => !(
              b.session_id === payload.new.session_id &&
              b.player_user_id === payload.new.player_user_id &&
              b.ball_number === payload.new.ball_number
            )),
            {
              session_id: payload.new.session_id,
              player_user_id: payload.new.player_user_id,
              ball_number: payload.new.ball_number,
              score: payload.new.score,
            },
          ]);
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "skeeball_sessions", filter: `id=eq.${sid}` }, (payload: any) => {
          setSessions((prev) => prev.map((s) =>
            s.id === sid
              ? { ...s, status: payload.new.status ?? s.status, placement: payload.new.placement ?? s.placement, league_points: payload.new.league_points ?? s.league_points }
              : s
          ));
        })
        .subscribe()
    );

    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (user) load();
    return () => { channelsRef.current.forEach((c) => c.unsubscribe()); };
  }, [user]);

  // TV mode (web): keep the screen awake while the dashboard is up
  useEffect(() => {
    if (Platform.OS !== "web") return;
    let lock: any = null;
    const acquire = async () => {
      try { lock = await (navigator as any).wakeLock?.request?.("screen"); } catch {}
    };
    acquire();
    const onVis = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      try { lock?.release?.(); } catch {}
    };
  }, []);

  // Auto-cycle between tonight's lanes and the season table when TV mode is on.
  useEffect(() => {
    if (!tvMode) { setPanel(0); return; }
    const hasTonight = sessions.length > 0;
    const hasSeason = season.length > 0;
    if (!hasTonight || !hasSeason) { setPanel(hasTonight ? 0 : 1); return; }
    const t = setInterval(() => setPanel((p) => (p === 0 ? 1 : 0)), 12000);
    return () => clearInterval(t);
  }, [tvMode, sessions.length, season.length]);

  function toggleFullscreen() {
    if (Platform.OS !== "web") return;
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } catch {}
  }

  // Confetti when the round finishes while we're watching
  const [celebrate, setCelebrate] = useState(false);
  const wasDoneRef = useRef(false);
  const roundDone = sessions.length > 0 && sessions.every((sess) => sess.status === "completed");
  useEffect(() => {
    if (roundDone && !wasDoneRef.current && sessions.length > 0) {
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 3500);
      return () => clearTimeout(t);
    }
    wasDoneRef.current = roundDone;
  }, [roundDone]);

  if (authLoading || loading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  // Live standings if the round ended now (by current totals)
  const totals = sessions.map((sess) => ({
    ...sess,
    total: balls.filter((b) => b.session_id === sess.id).reduce((a, b) => a + b.score, 0),
    thrown: balls.filter((b) => b.session_id === sess.id).length,
  })).sort((a, b) => b.total - a.total);

  const anyActive = sessions.some((sess) => sess.status === "active");
  const allDone = sessions.length > 0 && sessions.every((sess) => sess.status === "completed");

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Head><title>League Night Live · ArcadeTracker</title></Head>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/leagues" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={s.headerTitle}>League Night Live</Text>
            {anyActive && <View style={s.liveBadge}><View style={s.liveDot} /><Text style={s.liveBadgeText}>LIVE</Text></View>}
          </View>
          <Text style={s.headerSub}>
            {sessions.length}/{expected} teams checked in
            {allDone ? " · round complete" : ""}
          </Text>
        </View>
        {Platform.OS === "web" && (
          <Pressable
            style={s.backBtn}
            hitSlop={6}
            onPress={() => { const next = !tvMode; setTvMode(next); if (next && !document.fullscreenElement) toggleFullscreen(); }}
          >
            <Ionicons name="tv-outline" size={20} color={tvMode ? "#06b6d4" : "#555"} />
          </Pressable>
        )}
        {Platform.OS === "web" && (
          <Pressable style={s.backBtn} onPress={toggleFullscreen} hitSlop={6}>
            <Ionicons name="expand-outline" size={20} color="#555" />
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#06b6d4" />}
      >
        {tvMode && sessions.length > 0 && season.length > 0 && (
          <View style={s.tvDots}>
            <View style={[s.tvDot, panel === 0 && s.tvDotOn]} />
            <View style={[s.tvDot, panel === 1 && s.tvDotOn]} />
          </View>
        )}

        {panel === 1 && season.length > 0 ? (
          <>
            <Text style={s.sectionLabel}>Season Standings</Text>
            {season.map((t, i) => (
              <View key={i} style={s.teamCard}>
                <View style={s.teamRow}>
                  <Text style={s.placeNum}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.teamName}>{t.team_name}</Text>
                    <Text style={s.teamMeta}>🥇 {t.gold} · 🥈 {t.silver} · 🥉 {t.bronze}</Text>
                  </View>
                  <Text style={s.teamTotal}>{t.total_points}</Text>
                </View>
              </View>
            ))}
          </>
        ) : sessions.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="moon-outline" size={42} color="#333" />
            <Text style={s.emptyTitle}>No round in progress</Text>
            <Text style={s.emptySub}>This screen lights up on league night when teams check in to their lanes.</Text>
          </View>
        ) : (
          <>
            <Text style={s.sectionLabel}>{allDone ? "Final Standings" : "Live Standings"}</Text>
            {totals.map((t, i) => {
              const pct = Math.min(t.thrown / TOTAL_BALLS, 1);
              const place = t.placement ?? i + 1;
              return (
                <View key={t.id} style={[s.teamCard, t.status === "active" && s.teamCardActive]}>
                  <View style={s.teamRow}>
                    <Text style={s.placeNum}>
                      {allDone || t.placement
                        ? (place === 1 ? "🥇" : place === 2 ? "🥈" : place === 3 ? "🥉" : `${place}th`)
                        : `#${i + 1}`}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.teamName}>{t.team_name}</Text>
                      <Text style={s.teamMeta}>
                        Lane {t.lane_number} · {t.thrown}/{TOTAL_BALLS} balls
                        {t.status === "completed" ? " · finished" : ""}
                        {t.league_points != null ? ` · +${t.league_points} LP` : ""}
                      </Text>
                    </View>
                    <Text style={s.teamTotal}>{t.total}</Text>
                  </View>
                  {/* Ball progress bar */}
                  <View style={s.progressTrack}>
                    <View style={[s.progressFill, {
                      width: `${Math.round(pct * 100)}%` as any,
                      backgroundColor: t.status === "completed" ? "#22c55e" : "#06b6d4",
                    }]} />
                  </View>
                </View>
              );
            })}

            {!allDone && (
              <Text style={s.note}>
                Updates live as balls are recorded. Placements and league points are awarded automatically when all {expected} teams finish.
              </Text>
            )}
          </>
        )}
      </ScrollView>
      {celebrate && <ConfettiBurst />}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 32 },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "#777", fontSize: 12, marginTop: 1 },
  liveBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(239,68,68,0.12)", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.3)",
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#ef4444" },
  liveBadgeText: { color: "#ef4444", fontSize: 10, fontWeight: "900" },

  sectionLabel: {
    color: "#6b6b6b", fontSize: 10, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 12,
  },
  tvDots: { flexDirection: "row", justifyContent: "center", gap: 7, marginBottom: 14 },
  tvDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#2a2a2a" },
  tvDotOn: { backgroundColor: "#06b6d4", width: 18 },

  empty: { alignItems: "center", gap: 12, paddingVertical: 80, paddingHorizontal: 32 },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  emptySub: { color: "#8a8a8a", fontSize: 13.5, textAlign: "center", lineHeight: 19 },

  teamCard: {
    backgroundColor: "#111", borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: "#1a1a1a", gap: 10,
  },
  teamCardActive: { borderColor: "rgba(6,182,212,0.3)" },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  placeNum: { width: 36, fontSize: 18, fontWeight: "900", color: "#8a8a8a", textAlign: "center" },
  teamName: { color: "#fff", fontSize: 15, fontWeight: "800" },
  teamMeta: { color: "#8a8a8a", fontSize: 11.5, marginTop: 2 },
  teamTotal: { color: "#06b6d4", fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: "#1a1a1a", overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },

  note: { color: "#6b6b6b", fontSize: 11.5, textAlign: "center", lineHeight: 17, marginTop: 10, paddingHorizontal: 12 },
});
