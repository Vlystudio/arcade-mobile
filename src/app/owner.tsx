import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useRequireAuth } from "../hooks/use-require-auth";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type OwnerStats = {
  usersTotal: number;
  usersWeek: number;
  usersMonth: number;
  usersLastMonth: number;
  scoresTotal: number;
  scoresWeek: number;
  scoresMonth: number;
  scoresLastMonth: number;
  scoresPending: number;
  activePlayersWeek: number;
  teamsTotal: number;
  leaguesTotal: number;
  leagueMembersTotal: number;
  gameBreakdown: { type: string; count: number }[];
  topPlayers: { username: string; count: number }[];
  topGameNames: { name: string; count: number }[];
  skeeballSessions: number;
  postsWeek: number;
  checkInsWeek: number;
  reportsPending: number;
  activeTournaments: number;
  monthlyScores: { label: string; count: number }[];
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
  const [metrics, setMetrics] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadStats() {
    if (!user) return;

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!["owner", "architect"].includes(profile?.role ?? "")) { router.replace("/"); return; }

    const now = new Date();
    const weekAgo        = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();
    const monthAgo       = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [
      totalRes, weekRes, monthRes, lastMonthUsersRes,
      scoresTotalRes, scoresWeekRes, scoresMonthRes, scoresLastMonthRes, scoresPendingRes,
      teamsRes, leaguesRes, leagueMembersRes,
      recentScoresRes, skeeballRes,
      threeMonthScoresRes,
      postsWeekRes, checkInsWeekRes, reportsPendingRes, activeTournamentsRes,
    ] = await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", weekAgo),
      supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", thisMonthStart),
      supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", lastMonthStart).lte("created_at", lastMonthEnd),
      supabase.from("scores").select("*", { count: "exact", head: true }).eq("status", "approved"),
      supabase.from("scores").select("*", { count: "exact", head: true }).eq("status", "approved").gte("created_at", weekAgo),
      supabase.from("scores").select("*", { count: "exact", head: true }).eq("status", "approved").gte("created_at", thisMonthStart),
      supabase.from("scores").select("*", { count: "exact", head: true }).eq("status", "approved").gte("created_at", lastMonthStart).lte("created_at", lastMonthEnd),
      supabase.from("scores").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("teams").select("*", { count: "exact", head: true }),
      supabase.from("leagues").select("*", { count: "exact", head: true }),
      supabase.from("league_members").select("*", { count: "exact", head: true }),
      supabase.from("scores").select("user_id, games(id, name, type)").eq("status", "approved").gte("created_at", weekAgo),
      supabase.from("skeeball_sessions").select("*", { count: "exact", head: true }),
      supabase.from("scores").select("created_at").eq("status", "approved").gte("created_at", threeMonthsAgo),
      supabase.from("posts").select("*", { count: "exact", head: true }).gte("created_at", weekAgo),
      supabase.from("check_ins").select("*", { count: "exact", head: true }).gte("created_at", weekAgo),
      supabase.from("content_reports").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("tournaments").select("*", { count: "exact", head: true }).neq("status", "completed").neq("status", "cancelled"),
    ]);

    const recentRows = (recentScoresRes.data ?? []) as any[];
    const activePlayerIds = new Set(recentRows.map((r) => r.user_id));

    // Game type breakdown (this week)
    const gameMap: Record<string, number> = {};
    for (const row of recentRows) {
      const g = Array.isArray(row.games) ? row.games[0] : row.games;
      const type = g?.type ?? "arcade";
      gameMap[type] = (gameMap[type] ?? 0) + 1;
    }
    const gameBreakdown = Object.entries(gameMap)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    // Top individual game names this week
    const gameNameMap: Record<string, number> = {};
    for (const row of recentRows) {
      const g = Array.isArray(row.games) ? row.games[0] : row.games;
      const name = g?.name ?? TYPE_LABELS[g?.type ?? "arcade"] ?? "Unknown";
      gameNameMap[name] = (gameNameMap[name] ?? 0) + 1;
    }
    const topGameNames = Object.entries(gameNameMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Top players by game count this week
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

    // Monthly scores trend (3 months)
    const monthlyScores = Array.from({ length: 3 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (2 - i), 1);
      return { key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTH_NAMES[d.getMonth()], count: 0 };
    });
    for (const row of (threeMonthScoresRes.data ?? []) as any[]) {
      const d = new Date(row.created_at);
      const bucket = monthlyScores.find((b) => b.key === `${d.getFullYear()}-${d.getMonth()}`);
      if (bucket) bucket.count++;
    }

    setStats({
      usersTotal:         totalRes.count ?? 0,
      usersWeek:          weekRes.count ?? 0,
      usersMonth:         monthRes.count ?? 0,
      usersLastMonth:     lastMonthUsersRes.count ?? 0,
      scoresTotal:        scoresTotalRes.count ?? 0,
      scoresWeek:         scoresWeekRes.count ?? 0,
      scoresMonth:        scoresMonthRes.count ?? 0,
      scoresLastMonth:    scoresLastMonthRes.count ?? 0,
      scoresPending:      scoresPendingRes.count ?? 0,
      activePlayersWeek:  activePlayerIds.size,
      teamsTotal:         teamsRes.count ?? 0,
      leaguesTotal:       leaguesRes.count ?? 0,
      leagueMembersTotal: leagueMembersRes.count ?? 0,
      gameBreakdown,
      topPlayers,
      topGameNames,
      skeeballSessions:   skeeballRes.count ?? 0,
      postsWeek:          postsWeekRes.count ?? 0,
      checkInsWeek:       checkInsWeekRes.count ?? 0,
      reportsPending:     reportsPendingRes.count ?? 0,
      activeTournaments:  activeTournamentsRes.count ?? 0,
      monthlyScores:      monthlyScores.map(({ label, count }) => ({ label, count })),
    });
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { if (user) { loadStats(); loadMetrics(); } }, [user]);

  async function loadMetrics() {
    const { data } = await supabase.rpc("rpc_owner_metrics");
    if (data && !data.error) setMetrics(data);
  }

  if (authLoading || loading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#f59e0b" /></View>;
  }

  const st = stats!;
  const scoreMoM = st.scoresLastMonth > 0
    ? Math.round(((st.scoresMonth - st.scoresLastMonth) / st.scoresLastMonth) * 100)
    : null;
  const userMoM = st.usersLastMonth > 0
    ? Math.round(((st.usersMonth - st.usersLastMonth) / st.usersLastMonth) * 100)
    : null;

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
        {/* Score review callout — shown only when there are pending scores */}
        {st.scoresPending > 0 && (
          <View style={s.alertCard}>
            <Ionicons name="time-outline" size={20} color="#f59e0b" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.alertTitle}>{st.scoresPending} Score{st.scoresPending > 1 ? "s" : ""} Awaiting Review</Text>
              <Text style={s.alertBody}>Open the Admin panel to approve or reject pending score submissions.</Text>
            </View>
          </View>
        )}

        {/* User Activity */}
        <SectionLabel text="User Activity" />
        <View style={s.grid}>
          <StatCard label="Total Users"    value={st.usersTotal}  color="#06b6d4" icon="people-outline" />
          <StatCard label="New This Week"  value={st.usersWeek}   color="#22c55e" icon="person-add-outline" />
          <StatCard
            label="New This Month"
            value={st.usersMonth}
            color="#a855f7"
            icon="trending-up-outline"
            delta={userMoM}
          />
          <StatCard label="Active This Week" value={st.activePlayersWeek} color="#f59e0b" icon="flame-outline" />
        </View>

        {/* Engagement */}
        <SectionLabel text="Engagement" />
        <View style={s.grid}>
          <StatCard label="Total Scores"     value={st.scoresTotal}    color="#06b6d4" icon="trophy-outline" />
          <StatCard label="Scores This Week" value={st.scoresWeek}     color="#22c55e" icon="checkmark-circle-outline" />
          <StatCard
            label="Scores This Month"
            value={st.scoresMonth}
            color="#a855f7"
            icon="calendar-outline"
            delta={scoreMoM}
          />
          <StatCard label="Skee-Ball Sessions" value={st.skeeballSessions} color="#f59e0b" icon="bowling-ball-outline" />
          <StatCard
            label="Avg Games/Player"
            value={st.activePlayersWeek > 0 ? +(st.scoresWeek / st.activePlayersWeek).toFixed(1) : 0}
            color="#ef4444"
            icon="bar-chart-outline"
          />
          <StatCard label="Active Tournaments" value={st.activeTournaments} color="#06b6d4" icon="ribbon-outline" />
        </View>

        {/* Monthly Scores Trend */}
        <SectionLabel text="Monthly Games Tracked (3mo)" />
        <View style={s.chartCard}>
          {st.monthlyScores.map((m, i) => {
            const maxCount = Math.max(...st.monthlyScores.map((x) => x.count), 1);
            const pct = Math.round((m.count / maxCount) * 100);
            const isLatest = i === st.monthlyScores.length - 1;
            return (
              <View key={i} style={s.barCol}>
                <Text style={[s.barColValue, isLatest && { color: "#f59e0b" }]}>{m.count}</Text>
                <View style={s.barColTrack}>
                  <View style={[s.barColFill, { height: `${Math.max(pct, 4)}%` as any, backgroundColor: isLatest ? "#f59e0b" : "#333" }]} />
                </View>
                <Text style={[s.barColLabel, isLatest && { color: "#f59e0b" }]}>{m.label}</Text>
              </View>
            );
          })}
        </View>

        {/* Game Type Breakdown */}
        <SectionLabel text="Games This Week" />
        {st.gameBreakdown.length === 0 ? (
          <View style={s.emptyCard}><Text style={s.emptyText}>No scores this week.</Text></View>
        ) : (
          <View style={s.listCard}>
            {st.gameBreakdown.map((g, i) => {
              const total = st.scoresWeek || 1;
              const pct = Math.round((g.count / total) * 100);
              const color = TYPE_COLORS[g.type] ?? "#555";
              return (
                <View key={g.type} style={[s.listRow, i < st.gameBreakdown.length - 1 && s.listDivider]}>
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

        {/* Top Games by Name */}
        {st.topGameNames.length > 0 && (
          <>
            <SectionLabel text="Top Machines This Week" />
            <View style={s.listCard}>
              {st.topGameNames.map((g, i) => (
                <View key={g.name} style={[s.listRow, i < st.topGameNames.length - 1 && s.listDivider]}>
                  <Text style={s.rankText}>#{i + 1}</Text>
                  <Text style={s.listLabel}>{g.name}</Text>
                  <Text style={s.listValue}>{g.count} games</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* League & Teams */}
        <SectionLabel text="Leagues & Teams" />
        <View style={s.grid}>
          <StatCard label="Teams"         value={st.teamsTotal}         color="#06b6d4" icon="people-outline" />
          <StatCard label="Leagues"       value={st.leaguesTotal}       color="#22c55e" icon="layers-outline" />
          <StatCard label="League Players" value={st.leagueMembersTotal} color="#f59e0b" icon="person-outline" />
        </View>

        {/* Top Players */}
        {st.topPlayers.length > 0 && (
          <>
            <SectionLabel text="Top Players This Week" />
            <View style={s.listCard}>
              {st.topPlayers.map((p, i) => (
                <View key={p.username} style={[s.listRow, i < st.topPlayers.length - 1 && s.listDivider]}>
                  <Text style={s.rankText}>#{i + 1}</Text>
                  <Text style={s.listLabel}>{p.username}</Text>
                  <Text style={s.listValue}>{p.count} games</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Social & Activity */}
        <SectionLabel text="Social & Activity (this week)" />
        <View style={s.listCard}>
          <View style={[s.listRow, s.listDivider]}>
            <Ionicons name="create-outline" size={16} color="#555" />
            <Text style={s.listLabel}>New Posts</Text>
            <Text style={s.listValue}>{st.postsWeek.toLocaleString()}</Text>
          </View>
          <View style={[s.listRow, s.listDivider]}>
            <Ionicons name="qr-code-outline" size={16} color="#555" />
            <Text style={s.listLabel}>Lane Check-ins</Text>
            <Text style={s.listValue}>{st.checkInsWeek.toLocaleString()}</Text>
          </View>
          <View style={s.listRow}>
            <Ionicons
              name={st.reportsPending > 0 ? "flag-outline" : "flag-outline"}
              size={16}
              color={st.reportsPending > 0 ? "#ef4444" : "#555"}
            />
            <Text style={[s.listLabel, st.reportsPending > 0 && { color: "#ef4444" }]}>Content Reports Pending</Text>
            <Text style={[s.listValue, st.reportsPending > 0 && { color: "#ef4444" }]}>
              {st.reportsPending.toLocaleString()}
            </Text>
          </View>
        </View>

        {/* Business Impact */}
        <View style={s.impactCard}>
          <Ionicons name="trending-up" size={20} color="#f59e0b" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.impactTitle}>Business Impact</Text>
            <Text style={s.impactBody}>
              {st.activePlayersWeek} unique players engaged this week across {st.scoresWeek} tracked games.
              {scoreMoM !== null && ` Games this month are ${scoreMoM >= 0 ? "up" : "down"} ${Math.abs(scoreMoM)}% vs last month.`}
              {st.usersMonth > 0 ? ` ${st.usersMonth} new accounts created this month.` : ""}
            </Text>
          </View>
        </View>

        {metrics && (() => {
          const usd = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
          const ad = metrics.adoption ?? {};
          const fn = metrics.funnel ?? {};
          const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          const dowMax = Math.max(...(metrics.heat?.by_dow ?? []).map((d: any) => d.n), 1);
          const topHours = [...(metrics.heat?.by_hour ?? [])].sort((a: any, b: any) => b.n - a.n).slice(0, 4);
          const adoptionRows = [
            ["Karaoke", ad.karaoke], ["Pick'em", ad.pickem], ["Fantasy", ad.fantasy],
            ["Forums", ad.forums], ["Feed posts", ad.posts], ["DMs", ad.dms],
          ] as [string, number][];
          const funnelRows = [
            ["Signed up", fn.signups], ["Added a photo", fn.with_avatar],
            ["Joined a team", fn.on_team], ["Played a league game", fn.played_game],
          ] as [string, number][];
          return (
            <>
              <SectionLabel text="Revenue (Square, 8 weeks)" />
              <View style={s.listCard}>
                {(metrics.revenue?.weekly ?? []).length === 0 ? (
                  <Text style={s.metricEmpty}>No completed Square payments yet.</Text>
                ) : (
                  metrics.revenue.weekly.map((w: any) => (
                    <View key={w.week} style={s.metricRow}>
                      <Text style={s.metricLabel}>{new Date(w.week).toLocaleDateString([], { month: "short", day: "numeric" })}</Text>
                      <Text style={s.metricSub}>{w.payments} payments</Text>
                      <Text style={[s.metricVal, { color: "#22c55e" }]}>{usd(Number(w.cents))}</Text>
                    </View>
                  ))
                )}
                <View style={s.metricRow}>
                  <Text style={s.metricLabel}>Season registrations paid</Text>
                  <Text style={s.metricVal}>{metrics.revenue?.registrations_paid ?? 0}</Text>
                </View>
              </View>

              <SectionLabel text="Retention (weekly signup cohorts)" />
              <View style={s.listCard}>
                {(metrics.retention ?? []).length === 0 ? (
                  <Text style={s.metricEmpty}>No signups in the last 8 weeks.</Text>
                ) : (
                  metrics.retention.map((r: any) => (
                    <View key={r.week} style={s.metricRow}>
                      <Text style={s.metricLabel}>{new Date(r.week).toLocaleDateString([], { month: "short", day: "numeric" })}</Text>
                      <Text style={s.metricSub}>{r.signups} joined</Text>
                      <Text style={[s.metricVal, { color: "#06b6d4" }]}>
                        {r.signups > 0 ? Math.round((r.active_w1 / r.signups) * 100) : 0}% active wk 1
                      </Text>
                    </View>
                  ))
                )}
              </View>

              <SectionLabel text="League Night Attendance" />
              <View style={s.listCard}>
                {(metrics.attendance ?? []).length === 0 ? (
                  <Text style={s.metricEmpty}>No completed league games yet.</Text>
                ) : (
                  metrics.attendance.map((a: any) => (
                    <View key={a.week_of} style={s.metricRow}>
                      <Text style={s.metricLabel}>{new Date(a.week_of).toLocaleDateString([], { month: "short", day: "numeric" })}</Text>
                      <Text style={s.metricSub}>{a.teams} teams · {a.games} games</Text>
                      <Text style={[s.metricVal, { color: "#f59e0b" }]}>{a.players} players</Text>
                    </View>
                  ))
                )}
              </View>

              <SectionLabel text={`Feature Adoption (30d · ${ad.actives ?? 0} active players)`} />
              <View style={s.listCard}>
                {adoptionRows.map(([label, n]) => {
                  const pct = ad.actives > 0 ? Math.round(((n ?? 0) / ad.actives) * 100) : 0;
                  return (
                    <View key={label} style={s.metricRow}>
                      <Text style={s.metricLabel}>{label}</Text>
                      <View style={s.metricBarTrack}>
                        <View style={[s.metricBarFill, { width: `${Math.min(pct, 100)}%` as any }]} />
                      </View>
                      <Text style={s.metricVal}>{pct}%</Text>
                    </View>
                  );
                })}
              </View>

              <SectionLabel text="Signup Funnel" />
              <View style={s.listCard}>
                {funnelRows.map(([label, n], i) => {
                  const base = funnelRows[0][1] || 1;
                  const pct = Math.round(((n ?? 0) / base) * 100);
                  return (
                    <View key={label} style={s.metricRow}>
                      <Text style={s.metricLabel}>{i + 1}. {label}</Text>
                      <View style={s.metricBarTrack}>
                        <View style={[s.metricBarFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: "#a855f7" }]} />
                      </View>
                      <Text style={s.metricVal}>{n ?? 0}</Text>
                    </View>
                  );
                })}
              </View>

              <SectionLabel text="When People Play (30d)" />
              <View style={s.listCard}>
                {dows.map((label, dow) => {
                  const n = (metrics.heat?.by_dow ?? []).find((d: any) => d.dow === dow)?.n ?? 0;
                  return (
                    <View key={label} style={s.metricRow}>
                      <Text style={s.metricLabel}>{label}</Text>
                      <View style={s.metricBarTrack}>
                        <View style={[s.metricBarFill, { width: `${Math.round((n / dowMax) * 100)}%` as any, backgroundColor: "#f59e0b" }]} />
                      </View>
                      <Text style={s.metricVal}>{n}</Text>
                    </View>
                  );
                })}
                {topHours.length > 0 && (
                  <Text style={s.metricEmpty}>
                    Peak hours: {topHours.map((h: any) => `${h.hour}:00`).join(", ")}
                  </Text>
                )}
              </View>
            </>
          );
        })()}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={s.sectionLabel}>{text}</Text>;
}

function StatCard({
  label, value, color, icon, delta,
}: {
  label: string; value: number; color: string; icon: string; delta?: number | null;
}) {
  const displayValue = typeof value === "number" && !Number.isInteger(value)
    ? value.toFixed(1)
    : value.toLocaleString();
  return (
    <View style={s.statCard}>
      <View style={[s.statIcon, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <Text style={[s.statValue, { color }]}>{displayValue}</Text>
      <Text style={s.statLabel}>{label}</Text>
      {delta !== undefined && delta !== null && (
        <Text style={[s.deltaText, { color: delta >= 0 ? "#22c55e" : "#ef4444" }]}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% vs last month
        </Text>
      )}
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
  headerSub: { color: "#8a8a8a", fontSize: 12 },
  ownerBadge: {
    marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.25)",
  },
  ownerBadgeText: { color: "#f59e0b", fontSize: 11, fontWeight: "800" },

  sectionLabel: {
    color: "#777", fontSize: 11, fontWeight: "700", textTransform: "uppercase",
    letterSpacing: 1.2, marginTop: 24, marginBottom: 10,
  },

  alertCard: {
    flexDirection: "row", alignItems: "flex-start",
    backgroundColor: "rgba(245,158,11,0.08)", borderRadius: 16,
    padding: 16, marginTop: 16, borderWidth: 1, borderColor: "rgba(245,158,11,0.25)",
  },
  alertTitle: { color: "#f59e0b", fontSize: 14, fontWeight: "900", marginBottom: 2 },
  alertBody:  { color: "#777", fontSize: 12, lineHeight: 17 },

  chartCard: {
    flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around",
    backgroundColor: "#111", borderRadius: 18, borderWidth: 1, borderColor: "#1e1e1e",
    padding: 16, height: 110,
  },
  barCol: { flex: 1, alignItems: "center", height: "100%", justifyContent: "flex-end" },
  barColValue: { color: "#8a8a8a", fontSize: 11, fontWeight: "700", marginBottom: 4 },
  barColTrack: { width: "60%", flex: 1, backgroundColor: "#1a1a1a", borderRadius: 3, overflow: "hidden", justifyContent: "flex-end" },
  barColFill:  { width: "100%", borderRadius: 3 },
  barColLabel: { color: "#777", fontSize: 11, fontWeight: "700", marginTop: 6 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: {
    flex: 1, minWidth: "45%", backgroundColor: "#111", borderRadius: 18,
    padding: 18, borderWidth: 1, borderColor: "#1e1e1e",
  },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  statValue: { fontSize: 28, fontWeight: "900", letterSpacing: -0.5, marginBottom: 2 },
  statLabel: { color: "#8a8a8a", fontSize: 12, fontWeight: "600" },
  deltaText: { fontSize: 11, fontWeight: "700", marginTop: 4 },

  listCard: {
    backgroundColor: "#111", borderRadius: 18, borderWidth: 1, borderColor: "#1e1e1e",
    overflow: "hidden",
  },
  listRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  listDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  listLabel: { flex: 1, color: "#fff", fontSize: 14, fontWeight: "700" },
  listValue: { color: "#8a8a8a", fontSize: 13, fontWeight: "700" },
  rankText: { color: "#333", fontSize: 12, fontWeight: "900", width: 24 },

  gameColorDot: { width: 8, height: 8, borderRadius: 4 },
  barWrap: { flex: 1, height: 4, backgroundColor: "#1e1e1e", borderRadius: 2, overflow: "hidden" },
  bar: { height: 4, borderRadius: 2 },

  emptyCard: {
    backgroundColor: "#0d0d0d", borderRadius: 18, padding: 32, alignItems: "center",
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  emptyText: { color: "#777", fontSize: 14 },

  metricRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  metricLabel: { width: 120, color: "#ccc", fontSize: 12.5, fontWeight: "700" },
  metricSub: { flex: 1, color: "#777", fontSize: 11.5 },
  metricVal: { color: "#fff", fontSize: 13, fontWeight: "900", minWidth: 44, textAlign: "right" },
  metricBarTrack: { flex: 1, height: 7, borderRadius: 4, backgroundColor: "#1a1a1a", overflow: "hidden" },
  metricBarFill: { height: 7, borderRadius: 4, backgroundColor: "#06b6d4" },
  metricEmpty: { color: "#666", fontSize: 12, paddingVertical: 6 },

  impactCard: {
    flexDirection: "row", alignItems: "flex-start",
    backgroundColor: "rgba(245,158,11,0.06)", borderRadius: 18,
    padding: 18, marginTop: 24, borderWidth: 1, borderColor: "rgba(245,158,11,0.15)",
  },
  impactTitle: { color: "#f59e0b", fontSize: 14, fontWeight: "900", marginBottom: 4 },
  impactBody: { color: "#777", fontSize: 13, lineHeight: 19 },
});
