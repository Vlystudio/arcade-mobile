import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Head from "expo-router/head";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

const RING_COLORS: Record<number, string> = {
  10: "#64748b", 20: "#3b82f6", 30: "#06b6d4", 40: "#8b5cf6", 50: "#22c55e", 100: "#ef4444",
};

type GameRow = {
  session_id: string;
  week_of: string;
  lane_number: number;
  balls: number[];
  total: number;
};

export default function MyGamesScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [games, setGames] = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    if (!user) return;
    const { data } = await supabase
      .from("skeeball_ball_scores")
      .select("session_id, ball_number, score, skeeball_sessions!inner(week_of, lane_number, status, created_at)")
      .eq("player_user_id", user.id)
      .eq("skeeball_sessions.status", "completed")
      .order("created_at", { ascending: false, referencedTable: "skeeball_sessions" })
      .limit(600);

    const bySession = new Map<string, GameRow>();
    for (const b of data ?? []) {
      const sess: any = Array.isArray((b as any).skeeball_sessions)
        ? (b as any).skeeball_sessions[0]
        : (b as any).skeeball_sessions;
      const sid = (b as any).session_id;
      const row = bySession.get(sid) ?? {
        session_id: sid,
        week_of: sess?.week_of ?? "",
        lane_number: sess?.lane_number ?? 0,
        balls: [],
        total: 0,
      };
      row.balls[(b as any).ball_number - 1] = (b as any).score;
      row.total += (b as any).score;
      bySession.set(sid, row);
    }
    const rows = [...bySession.values()].sort((a, b) => (a.week_of < b.week_of ? 1 : -1));
    setGames(rows);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { if (user) load(); }, [user]);

  if (authLoading || loading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  const best = games.length ? Math.max(...games.map((g) => g.total)) : 0;

  // Group by week
  const byWeek = new Map<string, GameRow[]>();
  for (const g of games) {
    byWeek.set(g.week_of, [...(byWeek.get(g.week_of) ?? []), g]);
  }

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Head><title>My Games · ArcadeTracker</title></Head>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/profile" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>My Games</Text>
          <Text style={s.headerSub}>{games.length} league {games.length === 1 ? "game" : "games"} recorded</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#06b6d4" />}
      >
        {games.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="bowling-ball-outline" size={42} color="#333" />
            <Text style={s.emptyTitle}>No games yet</Text>
            <Text style={s.emptySub}>Your ball-by-ball league history shows up here after your first game.</Text>
          </View>
        ) : (
          [...byWeek.entries()].map(([week, weekGames]) => (
            <View key={week} style={{ marginBottom: 18 }}>
              <Text style={s.weekLabel}>
                Week of {new Date(week).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                {"  ·  "}{weekGames.length} {weekGames.length === 1 ? "game" : "games"}
                {"  ·  "}avg {Math.round(weekGames.reduce((a, g) => a + g.total, 0) / weekGames.length)}
              </Text>
              {weekGames.map((g) => (
                <View key={g.session_id} style={[s.gameCard, g.total === best && s.gameCardBest]}>
                  <View style={s.gameTop}>
                    <Text style={s.laneText}>Lane {g.lane_number}</Text>
                    {g.total === best && (
                      <View style={s.pbChip}><Text style={s.pbChipText}>CAREER BEST</Text></View>
                    )}
                    <Text style={s.totalText}>{g.total} pts</Text>
                  </View>
                  <View style={s.ballsRow}>
                    {g.balls.map((score, i) => (
                      <View key={i} style={[s.ballChip, { borderColor: (RING_COLORS[score] ?? "#555") + "55", backgroundColor: (RING_COLORS[score] ?? "#555") + "16" }]}>
                        <Text style={[s.ballChipText, { color: RING_COLORS[score] ?? "#8a8a8a" }]}>{score}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ))
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "#777", fontSize: 12, marginTop: 1 },
  content: { paddingHorizontal: 18, paddingTop: 16 },

  weekLabel: {
    color: "#777", fontSize: 11.5, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8,
  },
  gameCard: {
    backgroundColor: "#0d0d0d", borderRadius: 14, padding: 13, marginBottom: 8,
    borderWidth: 1, borderColor: "#1a1a1a", gap: 9,
  },
  gameCardBest: { borderColor: "rgba(245,158,11,0.35)" },
  gameTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  laneText: { color: "#8a8a8a", fontSize: 12.5, fontWeight: "700", flex: 1 },
  pbChip: { backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  pbChipText: { color: "#f59e0b", fontSize: 9, fontWeight: "900" },
  totalText: { color: "#06b6d4", fontSize: 17, fontWeight: "900" },
  ballsRow: { flexDirection: "row", gap: 6 },
  ballChip: { borderRadius: 9, paddingHorizontal: 11, paddingVertical: 5, borderWidth: 1 },
  ballChipText: { fontSize: 13, fontWeight: "800" },

  empty: { alignItems: "center", gap: 10, paddingVertical: 72, paddingHorizontal: 32 },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  emptySub: { color: "#8a8a8a", fontSize: 13.5, textAlign: "center", lineHeight: 19 },
});
