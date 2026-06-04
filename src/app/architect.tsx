import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useRequireAuth } from "../hooks/use-require-auth";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type ArchitectStats = {
  // Role breakdown
  roleCounts: Record<string, number>;
  // Table health
  tableCounts: Record<string, number>;
  // Monthly growth (last 6 months)
  monthlySignups: { label: string; count: number }[];
  monthlyScores: { label: string; count: number }[];
  // Peak usage
  scoresByDay: number[];
  peakDay: number;
  // Env var status
  envStatus: { key: string; present: boolean }[];
  // Feature usage
  gameTypeCounts: Record<string, number>;
  // Business impact
  usersTotal: number;
  scoresTotal: number;
  scoresThisMonth: number;
  uniquePlayersMonth: number;
  retentionRate: number;
};

export default function ArchitectScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [stats, setStats] = useState<ArchitectStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [apiStatus, setApiStatus] = useState<"checking" | "ok" | "error">("checking");

  async function loadStats() {
    if (!user) return;

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "architect") { router.replace("/"); return; }

    const now = new Date();
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

    const [
      profilesAll,
      scoresAll,
      scoresMonthRes,
      teamsCount, leaguesCount, leagueMembersCount,
      tournamentsCount, skeeballCount,
      recentSignups,
      recentScores,
      monthScores,
      gameTypeScores,
    ] = await Promise.all([
      supabase.from("profiles").select("role, created_at"),
      supabase.from("scores").select("*", { count: "exact", head: true }).eq("status", "approved"),
      supabase.from("scores").select("*", { count: "exact", head: true }).eq("status", "approved").gte("created_at", monthAgo),
      supabase.from("teams").select("*", { count: "exact", head: true }),
      supabase.from("leagues").select("*", { count: "exact", head: true }),
      supabase.from("league_members").select("*", { count: "exact", head: true }),
      supabase.from("tournaments").select("*", { count: "exact", head: true }),
      supabase.from("skeeball_sessions").select("*", { count: "exact", head: true }),
      supabase.from("profiles").select("created_at").gte("created_at", sixMonthsAgo),
      supabase.from("scores").select("created_at, user_id").eq("status", "approved").gte("created_at", threeMonthsAgo),
      supabase.from("scores").select("created_at").eq("status", "approved").gte("created_at", monthAgo),
      supabase.from("scores").select("games(type)").eq("status", "approved").gte("created_at", monthAgo),
    ]);

    // Role breakdown
    const roleCounts: Record<string, number> = { user: 0, admin: 0, owner: 0, architect: 0 };
    for (const p of (profilesAll.data ?? []) as any[]) {
      const r = p.role ?? "user";
      roleCounts[r] = (roleCounts[r] ?? 0) + 1;
    }

    // Table counts
    const tableCounts: Record<string, number> = {
      profiles: (profilesAll.data ?? []).length,
      teams: teamsCount.count ?? 0,
      leagues: leaguesCount.count ?? 0,
      league_members: leagueMembersCount.count ?? 0,
      tournaments: tournamentsCount.count ?? 0,
      skeeball_sessions: skeeballCount.count ?? 0,
    };

    // Monthly signups (last 6 months)
    const monthlySignups = buildMonthBuckets(now, 6);
    for (const p of (recentSignups.data ?? []) as any[]) {
      const d = new Date(p.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const bucket = monthlySignups.find((b) => b.key === key);
      if (bucket) bucket.count++;
    }

    // Monthly scores (last 3 months from recentScores)
    const monthlyScores = buildMonthBuckets(now, 3);
    for (const s of (recentScores.data ?? []) as any[]) {
      const d = new Date(s.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const bucket = monthlyScores.find((b) => b.key === key);
      if (bucket) bucket.count++;
    }

    // Scores by day of week
    const scoresByDay = [0, 0, 0, 0, 0, 0, 0];
    for (const s of (recentScores.data ?? []) as any[]) {
      scoresByDay[new Date(s.created_at).getDay()]++;
    }
    const peakDay = scoresByDay.indexOf(Math.max(...scoresByDay));

    // Unique players this month
    const uniquePlayerIds = new Set((monthScores.data ?? []).map((s: any) => s.user_id ?? ""));
    const uniquePlayersMonth = uniquePlayerIds.size;

    // Retention: players active this month who also had scores last month
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString();
    const { data: lastMonthScores } = await supabase
      .from("scores").select("user_id").eq("status", "approved")
      .gte("created_at", lastMonthStart).lte("created_at", lastMonthEnd);
    const lastMonthIds = new Set((lastMonthScores ?? []).map((s: any) => s.user_id ?? ""));
    const returning = [...uniquePlayerIds].filter((id) => lastMonthIds.has(id)).length;
    const retentionRate = uniquePlayersMonth > 0 ? Math.round((returning / uniquePlayersMonth) * 100) : 0;

    // Game type usage
    const gameTypeCounts: Record<string, number> = {};
    for (const row of (gameTypeScores.data ?? []) as any[]) {
      const g = Array.isArray(row.games) ? row.games[0] : row.games;
      const type = g?.type ?? "arcade";
      gameTypeCounts[type] = (gameTypeCounts[type] ?? 0) + 1;
    }

    // Env var status
    const envKeys = [
      "EXPO_PUBLIC_SUPABASE_URL",
      "EXPO_PUBLIC_SUPABASE_ANON_KEY",
      "EXPO_PUBLIC_SQUARE_APPLICATION_ID",
      "EXPO_PUBLIC_SITE_URL",
    ];
    const envStatus = envKeys.map((key) => ({
      key,
      present: !!(process.env[key]),
    }));

    // Check Square API reachability
    try {
      const res = await fetch("/api/square/menu?location=arcade_bar");
      setApiStatus(res.status < 500 ? "ok" : "error");
    } catch {
      setApiStatus("error");
    }

    setStats({
      roleCounts,
      tableCounts,
      monthlySignups: monthlySignups.map(({ label, count }) => ({ label, count })),
      monthlyScores: monthlyScores.map(({ label, count }) => ({ label, count })),
      scoresByDay,
      peakDay,
      envStatus,
      gameTypeCounts,
      usersTotal: (profilesAll.data ?? []).length,
      scoresTotal: scoresAll.count ?? 0,
      scoresThisMonth: scoresMonthRes.count ?? 0,
      uniquePlayersMonth,
      retentionRate,
    });
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { if (user) loadStats(); }, [user]);

  if (authLoading || loading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#a855f7" /></View>;
  }
  const st = stats!;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/profile" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View>
          <Text style={s.headerTitle}>Architect Panel</Text>
          <Text style={s.headerSub}>System health & analytics</Text>
        </View>
        <View style={s.archBadge}>
          <Ionicons name="checkmark-circle" size={13} color="#a855f7" />
          <Text style={s.archBadgeText}>Architect</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadStats(); }} tintColor="#a855f7" />}
      >
        {/* Business Impact */}
        <SectionLabel text="Business Impact" />
        <View style={s.grid}>
          <StatCard label="Total Users" value={st.usersTotal} color="#06b6d4" icon="people-outline" />
          <StatCard label="Total Games" value={st.scoresTotal} color="#22c55e" icon="trophy-outline" />
          <StatCard label="Games This Month" value={st.scoresThisMonth} color="#f59e0b" icon="calendar-outline" />
          <StatCard label="Active Players/mo" value={st.uniquePlayersMonth} color="#a855f7" icon="flame-outline" />
          <StatCard label="Retention Rate" value={st.retentionRate} color="#ef4444" icon="repeat-outline" suffix="%" />
        </View>

        {/* Monthly Growth */}
        <SectionLabel text="Monthly Signups (6mo)" />
        <View style={s.chartCard}>
          {st.monthlySignups.map((m, i) => {
            const maxCount = Math.max(...st.monthlySignups.map((x) => x.count), 1);
            const pct = Math.round((m.count / maxCount) * 100);
            return (
              <View key={i} style={s.barCol}>
                <Text style={s.barColValue}>{m.count}</Text>
                <View style={s.barColTrack}>
                  <View style={[s.barColFill, { height: `${Math.max(pct, 4)}%` as any, backgroundColor: "#06b6d4" }]} />
                </View>
                <Text style={s.barColLabel}>{m.label}</Text>
              </View>
            );
          })}
        </View>

        {/* Monthly Score Activity */}
        <SectionLabel text="Monthly Games Tracked (3mo)" />
        <View style={s.chartCard}>
          {st.monthlyScores.map((m, i) => {
            const maxCount = Math.max(...st.monthlyScores.map((x) => x.count), 1);
            const pct = Math.round((m.count / maxCount) * 100);
            return (
              <View key={i} style={s.barCol}>
                <Text style={s.barColValue}>{m.count}</Text>
                <View style={s.barColTrack}>
                  <View style={[s.barColFill, { height: `${Math.max(pct, 4)}%` as any, backgroundColor: "#22c55e" }]} />
                </View>
                <Text style={s.barColLabel}>{m.label}</Text>
              </View>
            );
          })}
        </View>

        {/* Peak Usage by Day */}
        <SectionLabel text="Activity by Day of Week (90 days)" />
        <View style={s.chartCard}>
          {st.scoresByDay.map((count, i) => {
            const maxCount = Math.max(...st.scoresByDay, 1);
            const pct = Math.round((count / maxCount) * 100);
            const isPeak = i === st.peakDay;
            return (
              <View key={i} style={s.barCol}>
                <Text style={[s.barColValue, isPeak && { color: "#f59e0b" }]}>{count}</Text>
                <View style={s.barColTrack}>
                  <View style={[s.barColFill, { height: `${Math.max(pct, 4)}%` as any, backgroundColor: isPeak ? "#f59e0b" : "#a855f7" }]} />
                </View>
                <Text style={[s.barColLabel, isPeak && { color: "#f59e0b" }]}>{DAY_LABELS[i]}</Text>
              </View>
            );
          })}
        </View>
        {st.scoresByDay[st.peakDay] > 0 && (
          <Text style={s.peakNote}>Peak day: {DAY_LABELS[st.peakDay]} ({st.scoresByDay[st.peakDay]} games in 90 days)</Text>
        )}

        {/* Feature Usage */}
        <SectionLabel text="Feature Usage This Month" />
        <View style={s.listCard}>
          {Object.entries(st.gameTypeCounts).sort((a, b) => b[1] - a[1]).map(([type, count], i, arr) => (
            <View key={type} style={[s.listRow, i < arr.length - 1 && s.listDivider]}>
              <View style={[s.dot, { backgroundColor: TYPE_COLORS[type] ?? "#555" }]} />
              <Text style={s.listLabel}>{TYPE_LABELS[type] ?? type}</Text>
              <Text style={s.listValue}>{count} games</Text>
            </View>
          ))}
          {Object.keys(st.gameTypeCounts).length === 0 && (
            <View style={s.listRow}><Text style={s.listValue}>No data this month</Text></View>
          )}
        </View>

        {/* User Role Breakdown */}
        <SectionLabel text="User Role Breakdown" />
        <View style={s.listCard}>
          {[
            { role: "architect", color: "#a855f7" },
            { role: "owner", color: "#f59e0b" },
            { role: "admin", color: "#3b82f6" },
            { role: "user", color: "#444" },
          ].map(({ role, color }, i) => (
            <View key={role} style={[s.listRow, i < 3 && s.listDivider]}>
              <Ionicons name="checkmark-circle" size={14} color={color} />
              <Text style={[s.listLabel, { color }]}>{role.charAt(0).toUpperCase() + role.slice(1)}</Text>
              <Text style={s.listValue}>{(st.roleCounts[role] ?? 0).toLocaleString()}</Text>
            </View>
          ))}
        </View>

        {/* Database Health */}
        <SectionLabel text="Database Table Counts" />
        <View style={s.listCard}>
          {Object.entries(st.tableCounts).map(([table, count], i, arr) => (
            <View key={table} style={[s.listRow, i < arr.length - 1 && s.listDivider]}>
              <Ionicons name="server-outline" size={14} color="#555" />
              <Text style={s.listLabel}>{table}</Text>
              <Text style={s.listValue}>{count.toLocaleString()} rows</Text>
            </View>
          ))}
        </View>

        {/* API Status */}
        <SectionLabel text="API & Integration Status" />
        <View style={s.listCard}>
          <View style={[s.listRow, s.listDivider]}>
            <Ionicons
              name={apiStatus === "ok" ? "checkmark-circle" : apiStatus === "error" ? "close-circle" : "time-outline"}
              size={16}
              color={apiStatus === "ok" ? "#22c55e" : apiStatus === "error" ? "#ef4444" : "#f59e0b"}
            />
            <Text style={s.listLabel}>Square API</Text>
            <Text style={[s.listValue, { color: apiStatus === "ok" ? "#22c55e" : apiStatus === "error" ? "#ef4444" : "#f59e0b" }]}>
              {apiStatus === "checking" ? "Checking…" : apiStatus === "ok" ? "Reachable" : "Unreachable"}
            </Text>
          </View>
          <View style={s.listRow}>
            <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
            <Text style={s.listLabel}>Supabase</Text>
            <Text style={[s.listValue, { color: "#22c55e" }]}>Connected</Text>
          </View>
        </View>

        {/* Env Var Status */}
        <SectionLabel text="Environment Variables" />
        <View style={s.listCard}>
          {st.envStatus.map(({ key, present }, i) => (
            <View key={key} style={[s.listRow, i < st.envStatus.length - 1 && s.listDivider]}>
              <Ionicons
                name={present ? "checkmark-circle" : "warning-outline"}
                size={14}
                color={present ? "#22c55e" : "#f59e0b"}
              />
              <Text style={[s.listLabel, { fontSize: 12 }]} numberOfLines={1}>{key}</Text>
              <Text style={[s.listValue, { color: present ? "#22c55e" : "#f59e0b" }]}>
                {present ? "Set" : "Missing"}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function buildMonthBuckets(now: Date, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1);
    return { key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTH_NAMES[d.getMonth()], count: 0 };
  });
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={s.sectionLabel}>{text}</Text>;
}

function StatCard({ label, value, color, icon, suffix = "" }: { label: string; value: number; color: string; icon: string; suffix?: string }) {
  return (
    <View style={s.statCard}>
      <View style={[s.statIcon, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <Text style={[s.statValue, { color }]}>{value.toLocaleString()}{suffix}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const TYPE_LABELS: Record<string, string> = {
  skeeball: "Skee-Ball", pinball: "Pinball", arcade: "Arcade",
  basketball: "Basketball", airhockey: "Air Hockey", pool: "Pool",
};
const TYPE_COLORS: Record<string, string> = {
  skeeball: "#06b6d4", pinball: "#a855f7", arcade: "#f59e0b",
  basketball: "#ef4444", airhockey: "#22c55e", pool: "#3b82f6",
};

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
  archBadge: {
    marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(168,85,247,0.12)", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: "rgba(168,85,247,0.25)",
  },
  archBadgeText: { color: "#a855f7", fontSize: 11, fontWeight: "800" },

  sectionLabel: {
    color: "#444", fontSize: 11, fontWeight: "700", textTransform: "uppercase",
    letterSpacing: 1.2, marginTop: 24, marginBottom: 10,
  },
  peakNote: { color: "#f59e0b", fontSize: 12, fontWeight: "600", marginTop: 8, textAlign: "center" },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: {
    flex: 1, minWidth: "45%", backgroundColor: "#111", borderRadius: 18,
    padding: 18, borderWidth: 1, borderColor: "#1e1e1e",
  },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  statValue: { fontSize: 28, fontWeight: "900", letterSpacing: -0.5, marginBottom: 2 },
  statLabel: { color: "#555", fontSize: 12, fontWeight: "600" },

  chartCard: {
    flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around",
    backgroundColor: "#111", borderRadius: 18, borderWidth: 1, borderColor: "#1e1e1e",
    padding: 16, height: 130,
  },
  barCol: { flex: 1, alignItems: "center", height: "100%", justifyContent: "flex-end" },
  barColValue: { color: "#555", fontSize: 10, fontWeight: "700", marginBottom: 4 },
  barColTrack: { width: "60%", flex: 1, backgroundColor: "#1a1a1a", borderRadius: 3, overflow: "hidden", justifyContent: "flex-end" },
  barColFill: { width: "100%", borderRadius: 3 },
  barColLabel: { color: "#444", fontSize: 10, fontWeight: "700", marginTop: 6 },

  listCard: {
    backgroundColor: "#111", borderRadius: 18, borderWidth: 1, borderColor: "#1e1e1e",
    overflow: "hidden",
  },
  listRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13, gap: 10 },
  listDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  listLabel: { flex: 1, color: "#fff", fontSize: 13, fontWeight: "700" },
  listValue: { color: "#555", fontSize: 12, fontWeight: "700" },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
