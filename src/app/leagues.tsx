import { Ionicons } from "@expo/vector-icons";
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
import BottomTabBar from "../components/bottom-tab-bar";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

type Season = { id: string; name: string; game_type: string; start_date: string; end_date: string; status: "planning" | "active" | "completed" };
type Standing = { team_id: string; team_name: string; wins: number; losses: number; points: number; isMyTeam: boolean };
type Match = { id: string; match_date: string; status: string; home_team: string; away_team: string; home_score: number | null; away_score: number | null };
type SkeeballStanding = { team_id: string; team_name: string; total_points: number; matches_played: number; gold: number; silver: number; bronze: number; isMyTeam: boolean };
type SkeeballMatchResult = { match_id: string; week_of: string; teams: { team_name: string; placement: number; league_points: number; game_score: number }[] };
type PageTab = "seasons" | "skeeball";

export default function LeaguesScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [pageTab, setPageTab] = useState<PageTab>("skeeball");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [skeeStandings, setSkeeStandings] = useState<SkeeballStanding[]>([]);
  const [skeeMatches, setSkeeMatches] = useState<SkeeballMatchResult[]>([]);
  const [skeeLoading, setSkeeLoading] = useState(false);

  async function loadLeagues() {
    if (!user) return;
    const [seasonsRes, myTeamRes] = await Promise.all([
      supabase.from("seasons").select("*").order("start_date", { ascending: false }),
      supabase.from("team_members").select("team_id").eq("user_id", user.id).maybeSingle(),
    ]);

    const allSeasons = (seasonsRes.data ?? []) as Season[];
    setSeasons(allSeasons);
    const teamId = (myTeamRes.data as any)?.team_id ?? null;
    setMyTeamId(teamId);

    const active = allSeasons.find((s) => s.status === "active") ?? allSeasons[0] ?? null;
    if (active) setActiveSeason(active);
    const targetId = selectedSeasonId ?? active?.id ?? null;
    if (targetId) await loadSeasonDetails(targetId, teamId);
    else { setLoading(false); setRefreshing(false); }
  }

  async function loadSeasonDetails(seasonId: string, teamId: string | null) {
    const [standRes, matchRes] = await Promise.all([
      supabase.from("league_teams").select("team_id, wins, losses, points, teams(name)").eq("season_id", seasonId).order("wins", { ascending: false }),
      supabase.from("matches").select("id, match_date, status, home_score, away_score, home:home_team_id(name), away:away_team_id(name)").eq("season_id", seasonId).order("match_date", { ascending: true }),
    ]);

    setStandings((standRes.data ?? []).map((lt: any) => ({
      team_id: lt.team_id,
      team_name: Array.isArray(lt.teams) ? lt.teams[0]?.name : lt.teams?.name ?? "Unknown",
      wins: lt.wins, losses: lt.losses, points: lt.points,
      isMyTeam: lt.team_id === teamId,
    })));

    setMatches((matchRes.data ?? []).map((m: any) => ({
      id: m.id, match_date: m.match_date, status: m.status,
      home_team: Array.isArray(m.home) ? m.home[0]?.name : m.home?.name ?? "TBD",
      away_team: Array.isArray(m.away) ? m.away[0]?.name : m.away?.name ?? "TBD",
      home_score: m.home_score, away_score: m.away_score,
    })));

    setLoading(false);
    setRefreshing(false);
  }

  async function loadSkeeballLeague(teamId: string | null) {
    setSkeeLoading(true);
    const [standRes, matchRes] = await Promise.all([
      supabase.from("skeeball_league_standings").select("*"),
      supabase
        .from("skeeball_league_matches")
        .select("id, week_of, skeeball_sessions(team_id, placement, league_points, teams(name), skeeball_ball_scores(score))")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    setSkeeStandings(
      (standRes.data ?? []).map((r: any) => ({
        team_id: r.team_id,
        team_name: r.team_name,
        total_points: r.total_points ?? 0,
        matches_played: r.matches_played ?? 0,
        gold: r.gold ?? 0,
        silver: r.silver ?? 0,
        bronze: r.bronze ?? 0,
        isMyTeam: r.team_id === teamId,
      }))
    );

    const results: SkeeballMatchResult[] = (matchRes.data ?? [])
      .map((m: any) => {
        const sessions = Array.isArray(m.skeeball_sessions) ? m.skeeball_sessions : [];
        const teams = sessions
          .filter((ss: any) => ss.placement != null)
          .map((ss: any) => {
            const teamName = Array.isArray(ss.teams) ? ss.teams[0]?.name : ss.teams?.name ?? "Unknown";
            const balls = Array.isArray(ss.skeeball_ball_scores) ? ss.skeeball_ball_scores : [];
            const gameScore = balls.reduce((sum: number, b: any) => sum + (b.score ?? 0), 0);
            return { team_name: teamName, placement: ss.placement, league_points: ss.league_points ?? 0, game_score: gameScore };
          })
          .sort((a: any, b: any) => a.placement - b.placement);
        return { match_id: m.id, week_of: m.week_of, teams };
      })
      .filter((m: SkeeballMatchResult) => m.teams.length > 0);

    setSkeeMatches(results);
    setSkeeLoading(false);
  }

  useEffect(() => {
    if (user) {
      loadLeagues();
    }
  }, [user]);

  useEffect(() => {
    if (user && myTeamId !== undefined) {
      loadSkeeballLeague(myTeamId);
    }
  }, [user, myTeamId]);

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  const displaySeason = seasons.find((s) => s.id === selectedSeasonId) ?? activeSeason;
  const upcoming = matches.filter((m) => m.status !== "completed");
  const completed = matches.filter((m) => m.status === "completed");

  const placementColor = (p: number) => p === 1 ? "#f59e0b" : p === 2 ? "#94a3b8" : p === 3 ? "#cd7c2f" : "#555";
  const placementEmoji = (p: number) => p === 1 ? "🥇" : p === 2 ? "🥈" : p === 3 ? "🥉" : "4️⃣";

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadLeagues();
                loadSkeeballLeague(myTeamId);
              }}
              tintColor="#06b6d4"
            />
          }
        >
          <Text style={styles.pageTitle}>Leagues</Text>
          <Text style={styles.pageSub}>Standings, schedules &amp; results</Text>

          {/* Tab switcher */}
          <View style={styles.tabRow}>
            <Pressable
              style={[styles.tabBtn, pageTab === "skeeball" && styles.tabBtnActive]}
              onPress={() => setPageTab("skeeball")}
            >
              <Text style={[styles.tabText, pageTab === "skeeball" && styles.tabTextActive]}>Skee-Ball League</Text>
            </Pressable>
            <Pressable
              style={[styles.tabBtn, pageTab === "seasons" && styles.tabBtnActive]}
              onPress={() => setPageTab("seasons")}
            >
              <Text style={[styles.tabText, pageTab === "seasons" && styles.tabTextActive]}>Seasons</Text>
            </Pressable>
          </View>

          {pageTab === "skeeball" ? (
            /* ── Skee-Ball League ── */
            <>
              {skeeLoading ? (
                <ActivityIndicator color="#06b6d4" style={{ marginVertical: 40 }} />
              ) : (
                <>
                  <SectionLabel text="Team Standings" />
                  {skeeStandings.length === 0 ? (
                    <View style={styles.emptyCard}>
                      <Ionicons name="bowling-ball-outline" size={36} color="#333" style={{ marginBottom: 12 }} />
                      <Text style={styles.emptyTitle}>No league games yet</Text>
                      <Text style={styles.emptySub}>Standings appear after teams complete their first league match on Monday night.</Text>
                    </View>
                  ) : (
                    <View style={styles.table}>
                      <View style={styles.tableHead}>
                        <Text style={[styles.tableCell, styles.rankCol]}>#</Text>
                        <Text style={[styles.tableCell, styles.nameCol]}>Team</Text>
                        <Text style={[styles.tableCell, styles.numCol]}>GP</Text>
                        <Text style={[styles.tableCell, { width: 52, textAlign: "center" }]}>🥇🥈🥉</Text>
                        <Text style={[styles.tableCell, styles.numCol]}>PTS</Text>
                      </View>
                      {skeeStandings.map((s, i) => (
                        <View key={s.team_id} style={[styles.tableRow, s.isMyTeam && styles.tableRowMe]}>
                          <Text style={[styles.tableCell, styles.rankCol, styles.rankText]}>{i + 1}</Text>
                          <View style={[styles.nameCol, { flexDirection: "row", alignItems: "center", gap: 6 }]}>
                            <Text style={styles.teamNameCell} numberOfLines={1}>{s.team_name}</Text>
                            {s.isMyTeam && <View style={styles.youBadge}><Text style={styles.youBadgeText}>YOU</Text></View>}
                          </View>
                          <Text style={[styles.tableCell, styles.numCol, { color: "#555" }]}>{s.matches_played}</Text>
                          <Text style={[styles.tableCell, { width: 52, textAlign: "center", fontSize: 11 }]}>
                            {s.gold > 0 ? `${s.gold}🥇 ` : ""}{s.silver > 0 ? `${s.silver}🥈 ` : ""}{s.bronze > 0 ? `${s.bronze}🥉` : ""}
                          </Text>
                          <Text style={[styles.tableCell, styles.numCol, { color: "#06b6d4", fontWeight: "900", fontSize: 15 }]}>{s.total_points}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={styles.leaguePointsKey}>
                    <Text style={styles.leaguePointsKeyTitle}>LEAGUE POINTS PER MATCH</Text>
                    {[["🥇", "1st", "4 pts"], ["🥈", "2nd", "3 pts"], ["🥉", "3rd", "2 pts"], ["4️⃣", "4th", "1 pt"]].map(([emoji, place, pts]) => (
                      <View key={place} style={styles.leaguePointsRow}>
                        <Text style={styles.leaguePointsEmoji}>{emoji}</Text>
                        <Text style={styles.leaguePointsPlace}>{place}</Text>
                        <Text style={styles.leaguePointsPts}>{pts}</Text>
                      </View>
                    ))}
                  </View>

                  {skeeMatches.length > 0 && (
                    <>
                      <SectionLabel text="Match Results" />
                      {skeeMatches.map((m) => (
                        <View key={m.match_id} style={styles.skeeMatchCard}>
                          <Text style={styles.skeeMatchDate}>Week of {fmtDate(m.week_of)}</Text>
                          {m.teams.map((t) => (
                            <View key={t.team_name + t.placement} style={styles.skeeMatchRow}>
                              <Text style={[styles.skeeMatchEmoji]}>{placementEmoji(t.placement)}</Text>
                              <Text style={styles.skeeMatchTeam} numberOfLines={1}>{t.team_name}</Text>
                              <Text style={styles.skeeMatchGameScore}>{t.game_score} pts</Text>
                              <Text style={[styles.skeeMatchLeaguePts, { color: placementColor(t.placement) }]}>+{t.league_points} LP</Text>
                            </View>
                          ))}
                        </View>
                      ))}
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            /* ── Seasons ── */
            <>
              {seasons.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="trophy-outline" size={40} color="#333" style={{ marginBottom: 12 }} />
                  <Text style={styles.emptyTitle}>No seasons yet</Text>
                  <Text style={styles.emptySub}>Seasons appear when created by an admin.</Text>
                </View>
              ) : (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillScroll} contentContainerStyle={styles.pillContent}>
                    {seasons.map((s) => {
                      const active = (selectedSeasonId ?? activeSeason?.id) === s.id;
                      return (
                        <Pressable
                          key={s.id}
                          style={[styles.pill, active && styles.pillActive]}
                          onPress={async () => { setSelectedSeasonId(s.id); setLoading(true); await loadSeasonDetails(s.id, myTeamId); }}
                        >
                          {s.status === "active" && <View style={styles.liveDot} />}
                          <Text style={[styles.pillText, active && styles.pillTextActive]}>{s.name}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  {displaySeason && (
                    <View style={styles.seasonBanner}>
                      <View>
                        <Text style={styles.seasonName}>{displaySeason.name}</Text>
                        <Text style={styles.seasonDates}>{fmtDate(displaySeason.start_date)} – {fmtDate(displaySeason.end_date)}</Text>
                      </View>
                      <StatusBadge status={displaySeason.status} />
                    </View>
                  )}
                  <SectionLabel text="Standings" />
                  {standings.length === 0 ? (
                    <View style={styles.emptyInline}><Text style={styles.emptyInlineText}>No standings yet</Text></View>
                  ) : (
                    <View style={styles.table}>
                      <View style={styles.tableHead}>
                        <Text style={[styles.tableCell, styles.rankCol]}>#</Text>
                        <Text style={[styles.tableCell, styles.nameCol]}>Team</Text>
                        <Text style={[styles.tableCell, styles.numCol]}>W</Text>
                        <Text style={[styles.tableCell, styles.numCol]}>L</Text>
                        <Text style={[styles.tableCell, styles.numCol]}>PTS</Text>
                      </View>
                      {standings.map((s, i) => (
                        <View key={s.team_id} style={[styles.tableRow, s.isMyTeam && styles.tableRowMe]}>
                          <Text style={[styles.tableCell, styles.rankCol, styles.rankText]}>{i + 1}</Text>
                          <View style={[styles.nameCol, { flexDirection: "row", alignItems: "center", gap: 6 }]}>
                            <Text style={styles.teamNameCell} numberOfLines={1}>{s.team_name}</Text>
                            {s.isMyTeam && <View style={styles.youBadge}><Text style={styles.youBadgeText}>YOU</Text></View>}
                          </View>
                          <Text style={[styles.tableCell, styles.numCol, { color: "#22c55e", fontWeight: "900" }]}>{s.wins}</Text>
                          <Text style={[styles.tableCell, styles.numCol, { color: "#ef4444", fontWeight: "900" }]}>{s.losses}</Text>
                          <Text style={[styles.tableCell, styles.numCol, { color: "#a855f7", fontWeight: "900" }]}>{s.points}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {upcoming.length > 0 && (
                    <>
                      <SectionLabel text="Upcoming Matches" />
                      {upcoming.slice(0, 5).map((m) => <MatchRow key={m.id} match={m} />)}
                    </>
                  )}
                  {completed.length > 0 && (
                    <>
                      <SectionLabel text="Recent Results" />
                      {completed.slice(-5).reverse().map((m) => <MatchRow key={m.id} match={m} showScore />)}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      <BottomTabBar />
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    active: { bg: "rgba(34,197,94,0.12)", color: "#22c55e" },
    planning: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b" },
    completed: { bg: "rgba(100,100,100,0.15)", color: "#666" },
  };
  const c = map[status] ?? map.planning;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.color }]}>{status.charAt(0).toUpperCase() + status.slice(1)}</Text>
    </View>
  );
}

function MatchRow({ match, showScore }: { match: Match; showScore?: boolean }) {
  return (
    <View style={styles.matchRow}>
      <View style={styles.matchTeams}>
        <Text style={styles.matchTeam}>{match.home_team}</Text>
        <Text style={styles.matchVs}>vs</Text>
        <Text style={styles.matchTeam}>{match.away_team}</Text>
      </View>
      {showScore && match.home_score != null ? (
        <Text style={styles.matchScore}>{match.home_score} – {match.away_score}</Text>
      ) : (
        <Text style={styles.matchDate}>{fmtDate(match.match_date)}</Text>
      )}
    </View>
  );
}

function fmtDate(iso: string) {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  safe: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },

  pageTitle: { color: "#fff", fontSize: 32, fontWeight: "900", letterSpacing: -0.5, marginBottom: 4 },
  pageSub: { color: "#555", fontSize: 14, marginBottom: 24 },

  emptyCard: { backgroundColor: "#0d0d0d", borderRadius: 20, padding: 40, alignItems: "center", borderWidth: 1, borderColor: "#1a1a1a" },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "800", marginBottom: 6 },
  emptySub: { color: "#555", fontSize: 14, textAlign: "center" },

  pillScroll: { marginBottom: 20 },
  pillContent: { gap: 8, paddingRight: 20 },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#111", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  pillActive: { borderColor: "rgba(6,182,212,0.4)", backgroundColor: "rgba(6,182,212,0.08)" },
  pillText: { color: "#555", fontWeight: "600", fontSize: 13 },
  pillTextActive: { color: "#06b6d4", fontWeight: "800" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e" },

  seasonBanner: {
    backgroundColor: "#111", borderRadius: 16, padding: 16,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 24,
  },
  seasonName: { color: "#fff", fontSize: 18, fontWeight: "900", marginBottom: 4 },
  seasonDates: { color: "#555", fontSize: 13 },
  badge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 12, fontWeight: "800" },

  sectionLabel: { color: "#444", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 12 },

  emptyInline: { paddingVertical: 16 },
  emptyInlineText: { color: "#444", fontSize: 14 },

  table: { backgroundColor: "#111", borderRadius: 16, borderWidth: 1, borderColor: "#1e1e1e", overflow: "hidden", marginBottom: 28 },
  tableHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#0a0a0a" },
  tableRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1e1e1e" },
  tableRowMe: { backgroundColor: "rgba(6,182,212,0.05)" },
  tableCell: { color: "#555", fontSize: 13, fontWeight: "600" },
  rankCol: { width: 28 },
  nameCol: { flex: 1 },
  numCol: { width: 36, textAlign: "center" },
  rankText: { color: "#06b6d4", fontWeight: "900" },
  teamNameCell: { color: "#fff", fontSize: 14, fontWeight: "800" },
  youBadge: { backgroundColor: "rgba(6,182,212,0.15)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  youBadgeText: { color: "#06b6d4", fontSize: 9, fontWeight: "900" },

  matchRow: {
    backgroundColor: "#111", borderRadius: 14, padding: 14,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 8,
  },
  matchTeams: { flex: 1, gap: 2 },
  matchTeam: { color: "#fff", fontSize: 14, fontWeight: "700" },
  matchVs: { color: "#333", fontSize: 11 },
  matchScore: { color: "#22c55e", fontWeight: "900", fontSize: 16 },
  matchDate: { color: "#555", fontSize: 13 },

  tabRow: { flexDirection: "row", gap: 8, marginBottom: 24 },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 14, backgroundColor: "#111", borderWidth: 1, borderColor: "#1e1e1e", alignItems: "center" },
  tabBtnActive: { borderColor: "rgba(6,182,212,0.4)", backgroundColor: "rgba(6,182,212,0.08)" },
  tabText: { color: "#555", fontWeight: "700", fontSize: 13 },
  tabTextActive: { color: "#06b6d4", fontWeight: "900" },

  leaguePointsKey: { backgroundColor: "#0d0d0d", borderRadius: 14, padding: 16, marginBottom: 28, borderWidth: 1, borderColor: "#1a1a1a" },
  leaguePointsKeyTitle: { color: "#333", fontSize: 10, fontWeight: "800", letterSpacing: 1, marginBottom: 10 },
  leaguePointsRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  leaguePointsEmoji: { fontSize: 18, width: 26 },
  leaguePointsPlace: { color: "#666", fontSize: 13, fontWeight: "700", flex: 1 },
  leaguePointsPts: { color: "#06b6d4", fontSize: 13, fontWeight: "900" },

  skeeMatchCard: { backgroundColor: "#111", borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#1e1e1e" },
  skeeMatchDate: { color: "#444", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  skeeMatchRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a" },
  skeeMatchEmoji: { fontSize: 20, width: 28 },
  skeeMatchTeam: { flex: 1, color: "#fff", fontSize: 14, fontWeight: "800" },
  skeeMatchGameScore: { color: "#555", fontSize: 13, fontWeight: "600" },
  skeeMatchLeaguePts: { fontSize: 13, fontWeight: "900", width: 48, textAlign: "right" },
});
