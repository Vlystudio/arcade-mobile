import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useRequireAuth } from "../hooks/use-require-auth";

type OwnerStats = {
  usersTotal: number;
  usersWeek: number;
  usersMonth: number;
  scoresTotal: number;
  scoresWeek: number;
  activePlayersWeek: number;
  teamsTotal: number;
  leaguesTotal: number;
  leagueMembersTotal: number;
  gameBreakdown: { type: string; count: number }[];
  topPlayers: { username: string; count: number }[];
  skeeballSessions: number;
};

const TYPE_LABELS: Record<string, string> = {
  skeeball: "Skee-Ball", pinball: "Pinball", arcade: "Arcade",
  basketball: "Basketball", airhockey: "Air Hockey", pool: "Pool",
};
const TYPE_COLORS: Record<string, string> = {
  skeeball: "#06b6d4", pinball: "#a855f7", arcade: "#f59e0b",
  basketball: "#ef4444", airhockey: "#22c55e", pool: "#3b82f6",
};

export default function OwnerScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [stats, setStats] = useState<OwnerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadStats() {
    if (!user) return;

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!["owner", "architect"].includes(profile?.role ?? "")) { router.replace("/"); return; }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [
      totalRes, weekRes, monthRes,
      scoresTotalRes, scoresWeekRes,
      teamsRes, leaguesRes, leagueMembersRes,
      recentScoresRes, skeeballRes,
    ] = await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", weekAgo),
      supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", monthAgo),
      supabase.from("scores").select("*", { count: "exact", head: true }).eq("status", "approved"),
      supabase.from("scores").select("*", { count: "exact", head: true }).eq("status", "approved").gte("created_at", weekAgo),
      supabase.from("teams").select("*", { count: "exact", head: true }),
      supabase.from("leagues").select("*", { count: "exact", head: true }),
      supabase.from("league_members").select("*", { count: "exact", head: true }),
      supabase.from("scores").select("user_id, games(type)").eq("status", "approved").gte("created_at", weekAgo),
      supabase.from("skeeball_sessions").select("*", { count: "exact", head: true }),
    ]);

    // Compute active players this week
    const recentRows = (recentScoresRes.data ?? []) as any[];
    const activePlayerIds = new Set(recentRows.map((r) => r.user_id));

    // Game type breakdown
    const gameMap: Record<string, number> = {};
    for (const row of recentRows) {
      const g = Array.isArray(row.games) ? row.games[0] : row.games;
      const type = g?.type ?? "arcade";
      gameMap[type] = (gameMap[type] ?? 0) + 1;
    }
    const gameBreakdown = Object.entries(gameMap)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    // Top players by games this week
    const playerMap: Record<string, number> = {};
    for (const row of recentRows) playerMap[row.user_id] = (playerMap[row.user_id] ?? 0) + 1;
    const topPlayerIds = Object.entries(playerMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
    let topPlayers: { username: string; count: number }[] = [];
    if (topPlayerIds.length > 0) {
      const { data: pData } = await supabase.from("profiles").select("id, username").in("id", topPlayerIds);
      topPlayers = topPlayerIds.map((id) => ({
        username: (pData ?? []).find((p: any) => p.id === id)?.username ?? "Unknown",
        count: playerMap[id],
      }));
    }

    setStats({
      usersTotal: totalRes.count ?? 0,
      usersWeek: weekRes.count ?? 0,
      usersMonth: monthRes.count ?? 0,
      scoresTotal: scoresTotalRes.count ?? 0,
      scoresWeek: scoresWeekRes.count ?? 0,
      activePlayersWeek: activePlayerIds.size,
      teamsTotal: teamsRes.count ?? 0,
      leaguesTotal: leaguesRes.count ?? 0,
      leagueMembersTotal: leagueMembersRes.count ?? 0,
      gameBreakdown,
      topPlayers,
      skeeballSessions: skeeballRes.count ?? 0,
    });
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { if (user) loadStats(); }, [user]);

  if (authLoading || loading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#f59e0b" /></View>;
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/profile" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View>
          <Text style={s.headerTitle}>Owner Dashboard</Text>
          <Text style={s.headerSub}>Venue analytics</Text>
        </View>
        <View style={s.ownerBadge}>
          <Ionicons name="checkmark-circle" size={13} color="#f59e0b" />
          <Text style={s.ownerBadgeText}>Owner</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadStats(); }} tintColor="#f59e0b" />}
      >
        {/* User Activity */}
        <SectionLabel text="User Activity" />
        <View style={s.grid}>
          <StatCard label="Total Users" value={stats!.usersTotal} color="#06b6d4" icon="people-outline" />
          <StatCard label="New This Week" value={stats!.usersWeek} color="#22c55e" icon="person-add-outline" />
          <StatCard label="New This Month" value={stats!.usersMonth} color="#a855f7" icon="trending-up-outline" />
          <StatCard label="Active This Week" value={stats!.activePlayersWeek} color="#f59e0b" icon="flame-outline" />
        </View>

        {/* Engagement */}
        <SectionLabel text="Engagement" />
        <View style={s.grid}>
          <StatCard label="Total Scores" value={stats!.scoresTotal} color="#06b6d4" icon="trophy-outline" />
          <StatCard label="Scores This Week" value={stats!.scoresWeek} color="#22c55e" icon="checkmark-circle-outline" />
          <StatCard label="Skee-Ball Sessions" value={stats!.skeeballSessions} color="#f59e0b" icon="bowling-ball-outline" />
          <StatCard
            label="Avg Games/Player"
            value={stats!.activePlayersWeek > 0 ? +(stats!.scoresWeek / stats!.activePlayersWeek).toFixed(1) : 0}
            color="#a855f7"
            icon="bar-chart-outline"
          />
        </View>

        {/* Game Type Breakdown */}
        <SectionLabel text="Games This Week" />
        {stats!.gameBreakdown.length === 0 ? (
          <View style={s.emptyCard}><Text style={s.emptyText}>No scores this week.</Text></View>
        ) : (
          <View style={s.listCard}>
            {stats!.gameBreakdown.map((g, i) => {
              const total = stats!.scoresWeek || 1;
              const pct = Math.round((g.count / total) * 100);
              const color = TYPE_COLORS[g.type] ?? "#555";
              return (
                <View key={g.type} style={[s.listRow, i < stats!.gameBreakdown.length - 1 && s.listDivider]}>
                  <View style={[s.gameColorDot, { backgroundColor: color }]} />
                  <Text style={s.listLabel}>{TYPE_LABELS[g.type] ?? g.type}</Text>
                  <View style={s.barWrap}>
                    <View style={[s.bar, { width: `${pct}%` as any, backgroundColor: color }]} />
                  </View>
                  <Text style={[s.listValue, { color }]}>{g.count}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* League & Teams */}
        <SectionLabel text="Leagues & Teams" />
        <View style={s.grid}>
          <StatCard label="Teams" value={stats!.teamsTotal} color="#06b6d4" icon="people-outline" />
          <StatCard label="Leagues" value={stats!.leaguesTotal} color="#22c55e" icon="layers-outline" />
          <StatCard label="League Players" value={stats!.leagueMembersTotal} color="#f59e0b" icon="person-outline" />
        </View>

        {/* Top Players */}
        {stats!.topPlayers.length > 0 && (
          <>
            <SectionLabel text="Top Players This Week" />
            <View style={s.listCard}>
              {stats!.topPlayers.map((p, i) => (
                <View key={p.username} style={[s.listRow, i < stats!.topPlayers.length - 1 && s.listDivider]}>
                  <Text style={s.rankText}>#{i + 1}</Text>
                  <Text style={s.listLabel}>{p.username}</Text>
                  <Text style={s.listValue}>{p.count} games</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Business Impact Note */}
        <View style={s.impactCard}>
          <Ionicons name="trending-up" size={20} color="#f59e0b" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.impactTitle}>Business Impact</Text>
            <Text style={s.impactBody}>
              {stats!.activePlayersWeek} unique players engaged this week across {stats!.scoresWeek} tracked games.
              {stats!.usersMonth > 0 ? ` ${stats!.usersMonth} new accounts created this month.` : ""}
            </Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={s.sectionLabel}>{text}</Text>;
}

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <View style={s.statCard}>
      <View style={[s.statIcon, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <Text style={[s.statValue, { color }]}>{typeof value === "number" && !Number.isInteger(value) ? value.toFixed(1) : value.toLocaleString()}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 16, paddingBottom: 48 },

  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "#555", fontSize: 12 },
  ownerBadge: {
    marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.25)",
  },
  ownerBadgeText: { color: "#f59e0b", fontSize: 11, fontWeight: "800" },

  sectionLabel: {
    color: "#444", fontSize: 11, fontWeight: "700", textTransform: "uppercase",
    letterSpacing: 1.2, marginTop: 24, marginBottom: 10,
  },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: {
    flex: 1, minWidth: "45%", backgroundColor: "#111", borderRadius: 18,
    padding: 18, borderWidth: 1, borderColor: "#1e1e1e",
  },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  statValue: { fontSize: 28, fontWeight: "900", letterSpacing: -0.5, marginBottom: 2 },
  statLabel: { color: "#555", fontSize: 12, fontWeight: "600" },

  listCard: {
    backgroundColor: "#111", borderRadius: 18, borderWidth: 1, borderColor: "#1e1e1e",
    overflow: "hidden",
  },
  listRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  listDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  listLabel: { flex: 1, color: "#fff", fontSize: 14, fontWeight: "700" },
  listValue: { color: "#555", fontSize: 13, fontWeight: "700" },
  rankText: { color: "#333", fontSize: 12, fontWeight: "900", width: 24 },

  gameColorDot: { width: 8, height: 8, borderRadius: 4 },
  barWrap: { flex: 1, height: 4, backgroundColor: "#1e1e1e", borderRadius: 2, overflow: "hidden" },
  bar: { height: 4, borderRadius: 2 },

  emptyCard: {
    backgroundColor: "#0d0d0d", borderRadius: 18, padding: 32, alignItems: "center",
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  emptyText: { color: "#444", fontSize: 14 },

  impactCard: {
    flexDirection: "row", alignItems: "flex-start",
    backgroundColor: "rgba(245,158,11,0.06)", borderRadius: 18,
    padding: 18, marginTop: 24, borderWidth: 1, borderColor: "rgba(245,158,11,0.15)",
  },
  impactTitle: { color: "#f59e0b", fontSize: 14, fontWeight: "900", marginBottom: 4 },
  impactBody: { color: "#777", fontSize: 13, lineHeight: 19 },
});
