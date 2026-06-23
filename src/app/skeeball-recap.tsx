import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useRequireAuth } from "../hooks/use-require-auth";
import { ScoreText } from "../components/score-text";
import { EmptyState } from "../components/empty-state";

type Night = {
  has_data: boolean;
  week_of?: string;
  total_pts?: number;
  balls?: number;
  games?: number;
  best_game?: number;
  best_ring?: number;
  ring_counts?: Record<string, number>;
  team_name?: string | null;
  team_placement?: number | null;
  rank?: number;
  players?: number;
  is_pb?: boolean;
  streak?: number;
};

const RING_COLORS: Record<number, string> = { 10: "#6b7280", 20: "#6b7280", 30: "#3b82f6", 40: "#8b5cf6", 50: "#22c55e", 100: "#06b6d4" };
const ORDINAL = (n: number) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;

function fmtWeek(d?: string) {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function SkeeballRecapScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [night, setNight] = useState<Night | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase.rpc("rpc_my_skeeball_night").then(({ data }) => {
      setNight((data as Night) ?? { has_data: false });
      setLoading(false);
    });
  }, [user?.id]);

  async function share() {
    if (!night?.has_data) return;
    const lines = [
      `🎳 My skee-ball night — ${fmtWeek(night.week_of)}`,
      `${night.total_pts} pts across ${night.games} game${night.games === 1 ? "" : "s"}`,
      `Best game: ${night.best_game}${night.is_pb ? " (new PB! 🔥)" : ""}`,
      night.rank ? `Ranked ${ORDINAL(night.rank)} of ${night.players} tonight` : "",
      (night.streak ?? 0) > 1 ? `${night.streak} weeks in a row 💪` : "",
      "vlystudios.com",
    ].filter(Boolean);
    try { await Share.share({ message: lines.join("\n") }); } catch {}
  }

  const rings = Object.entries(night?.ring_counts ?? {}).map(([k, v]) => ({ ring: Number(k), n: v })).sort((a, b) => b.ring - a.ring);
  const maxN = Math.max(1, ...rings.map((r) => r.n));

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable style={s.iconBtn} hitSlop={10} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>My Night</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading || authLoading ? (
        <View style={s.center}><ActivityIndicator color="#06b6d4" /></View>
      ) : !night?.has_data ? (
        <EmptyState
          icon="game-controller-outline"
          title="No league night yet"
          subtitle="Once you've scored a game on a lane, your night recap shows up here."
          ctaLabel="Find a lane"
          onPress={() => router.replace("/teams" as any)}
        />
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.week}>{fmtWeek(night.week_of)}</Text>
          {night.is_pb && (
            <View style={s.pbBanner}>
              <Ionicons name="flame" size={16} color="#f59e0b" />
              <Text style={s.pbText}>New personal best — {night.best_game} pts!</Text>
            </View>
          )}

          <View style={s.heroCard}>
            <Text style={s.heroLabel}>TOTAL TONIGHT</Text>
            <ScoreText value={night.total_pts ?? 0} animate style={s.heroValue} />
            <Text style={s.heroSub}>{night.balls} balls · {night.games} game{night.games === 1 ? "" : "s"}</Text>
          </View>

          <View style={s.statRow}>
            <View style={s.statCard}>
              <Ionicons name="trophy-outline" size={18} color="#fbbf24" />
              <Text style={s.statValue}>{night.best_game}</Text>
              <Text style={s.statLabel}>Best game</Text>
            </View>
            <View style={s.statCard}>
              <Ionicons name="podium-outline" size={18} color="#06b6d4" />
              <Text style={s.statValue}>{night.rank ? ORDINAL(night.rank) : "—"}</Text>
              <Text style={s.statLabel}>of {night.players} tonight</Text>
            </View>
            <View style={s.statCard}>
              <Ionicons name="flame-outline" size={18} color="#ef4444" />
              <Text style={s.statValue}>{night.streak ?? 1}</Text>
              <Text style={s.statLabel}>week{(night.streak ?? 1) === 1 ? "" : "s"} streak</Text>
            </View>
          </View>

          {rings.length > 0 && (
            <View style={s.ringsCard}>
              <Text style={s.cardTitle}>Where your balls landed</Text>
              {rings.map((r) => (
                <View key={r.ring} style={s.ringRow}>
                  <Text style={[s.ringLabel, { color: RING_COLORS[r.ring] ?? "#888" }]}>{r.ring}</Text>
                  <View style={s.ringBarTrack}>
                    <View style={[s.ringBarFill, { width: `${(r.n / maxN) * 100}%`, backgroundColor: RING_COLORS[r.ring] ?? "#888" }]} />
                  </View>
                  <Text style={s.ringN}>{r.n}</Text>
                </View>
              ))}
            </View>
          )}

          {night.team_name ? (
            <Text style={s.teamLine}>
              Played for <Text style={{ color: "#06b6d4", fontWeight: "800" }}>{night.team_name}</Text>
              {night.team_placement ? ` · finished ${ORDINAL(night.team_placement)}` : ""}
            </Text>
          ) : null}

          <Pressable style={s.shareBtn} onPress={share}>
            <Ionicons name="share-social-outline" size={18} color="#001016" />
            <Text style={s.shareText}>Share my night</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: 18, paddingBottom: 40 },
  week: { color: "#8a8a8a", fontSize: 14, fontWeight: "700", textAlign: "center", marginTop: 4, marginBottom: 14 },
  pbBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    backgroundColor: "rgba(245,158,11,0.1)", borderColor: "rgba(245,158,11,0.35)", borderWidth: 1,
    borderRadius: 12, paddingVertical: 9, marginBottom: 14,
  },
  pbText: { color: "#f59e0b", fontSize: 13.5, fontWeight: "800" },
  heroCard: {
    backgroundColor: "#0c0c0c", borderColor: "#1c1c1c", borderWidth: 1, borderRadius: 20,
    alignItems: "center", paddingVertical: 26, marginBottom: 12,
  },
  heroLabel: { color: "#5a5a5a", fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  heroValue: { color: "#06b6d4", fontSize: 54, fontWeight: "900", letterSpacing: -2, marginTop: 4 },
  heroSub: { color: "#7a7a7a", fontSize: 13, marginTop: 2 },
  statRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  statCard: {
    flex: 1, backgroundColor: "#0c0c0c", borderColor: "#1c1c1c", borderWidth: 1, borderRadius: 16,
    alignItems: "center", paddingVertical: 16, gap: 4,
  },
  statValue: { color: "#fff", fontSize: 20, fontWeight: "900" },
  statLabel: { color: "#777", fontSize: 11, fontWeight: "600", textAlign: "center" },
  ringsCard: { backgroundColor: "#0c0c0c", borderColor: "#1c1c1c", borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12 },
  cardTitle: { color: "#aaa", fontSize: 12, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 12 },
  ringRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  ringLabel: { width: 28, fontSize: 14, fontWeight: "900", textAlign: "right" },
  ringBarTrack: { flex: 1, height: 10, borderRadius: 6, backgroundColor: "#161616", overflow: "hidden" },
  ringBarFill: { height: "100%", borderRadius: 6 },
  ringN: { width: 22, color: "#ccc", fontSize: 13, fontWeight: "800", textAlign: "right" },
  teamLine: { color: "#9a9a9a", fontSize: 13.5, textAlign: "center", marginVertical: 6 },
  shareBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9,
    backgroundColor: "#06b6d4", borderRadius: 999, paddingVertical: 14, marginTop: 16,
  },
  shareText: { color: "#001016", fontSize: 15, fontWeight: "800" },
});
