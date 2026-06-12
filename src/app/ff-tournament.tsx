import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useRequireAuth } from "../hooks/use-require-auth";

// ─── Types ────────────────────────────────────────────────────────────────────

type FFTournament = {
  id: string;
  status: string;
  proposed_date: string | null;
  ff_signup_time: string | null;
  ff_start_time: string | null;
  signup_qr_active: boolean;
  max_players: number;
  registered_count: number;
  placements: { placement: number; username: string; user_id: string }[];
};

type ChampionEntry = {
  user_id: string;
  username: string;
  wins: number;
  podiums: number;
  top4s: number;
  lastWin: string | null;
};

type BracketSlot  = { user_id: string; username: string; seed: number; status: string; eliminated_game: number | null; final_rank: number | null };
type BracketScore = { user_id: string; username: string; score: number; rank_in_game: number; is_eliminated: boolean };
type BracketGame  = { id: string; game_number: number; status: string; scores: BracketScore[] | null };
type BracketGroup = { id: string; group_number: number; status: string; slots: BracketSlot[] | null; games: BracketGame[] | null };
type BracketRound = { id: string; round_number: number; round_name: string; status: string; groups: BracketGroup[] | null };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MEDALS = ["🥇", "🥈", "🥉", "4️⃣"];

function fmtLongDate(iso: string | null) {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function fmtMonthYear(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FFTournamentScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [tournaments, setTournaments] = useState<FFTournament[]>([]);
  const [champions, setChampions] = useState<ChampionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [viewBracketId, setViewBracketId] = useState<string | null>(null);
  const [viewBracketData, setViewBracketData] = useState<{ rounds: BracketRound[] } | null>(null);
  const [viewBracketLoading, setViewBracketLoading] = useState(false);
  const [viewBracketTab, setViewBracketTab] = useState(1);

  async function load() {
    if (!user) return;

    const { data: tourneysRaw } = await supabase
      .from("tournaments")
      .select("id, status, proposed_date, ff_signup_time, ff_start_time, signup_qr_active, max_players")
      .eq("is_individual", true)
      .eq("game_type", "Skee-Ball")
      .order("proposed_date", { ascending: false });

    const tourneys: any[] = tourneysRaw ?? [];

    const activeIds = tourneys.filter(t => ["active", "upcoming"].includes(t.status)).map(t => t.id);
    const regCountMap: Record<string, number> = {};
    if (activeIds.length > 0) {
      const { data: regs } = await supabase
        .from("tournament_registrations")
        .select("tournament_id")
        .in("tournament_id", activeIds)
        .eq("status", "accepted");
      for (const r of regs ?? []) {
        regCountMap[(r as any).tournament_id] = (regCountMap[(r as any).tournament_id] ?? 0) + 1;
      }
    }

    const completedIds = tourneys.filter(t => t.status === "completed").map(t => t.id);
    const placementsMap: Record<string, { placement: number; username: string; user_id: string }[]> = {};
    const champMap: Record<string, ChampionEntry> = {};

    if (completedIds.length > 0) {
      const { data: pData } = await supabase
        .from("tournament_placements")
        .select("tournament_id, placement, user_id, username, profiles(username)")
        .in("tournament_id", completedIds)
        .order("placement");

      for (const p of pData ?? []) {
        // Prefer username stored on the row (guests), fall back to joined profile
        const profileName =
          Array.isArray((p as any).profiles)
            ? (p as any).profiles[0]?.username
            : (p as any).profiles?.username;
        const name = (p as any).username ?? profileName ?? "Unknown";
        const uid = (p as any).user_id;
        const isGuest = !profileName; // no profile = guest player
        const placement = (p as any).placement;
        const tid = (p as any).tournament_id;

        if (!placementsMap[tid]) placementsMap[tid] = [];
        placementsMap[tid].push({ placement, username: name, user_id: uid });

        // Only build Hall of Champions for registered (non-guest) players
        if (!isGuest && uid) {
          if (!champMap[uid]) {
            champMap[uid] = { user_id: uid, username: name, wins: 0, podiums: 0, top4s: 0, lastWin: null };
          }
          const c = champMap[uid];
          if (placement === 1) {
            c.wins += 1;
            const tourn = tourneys.find(t => t.id === tid);
            if (!c.lastWin || (tourn?.proposed_date && tourn.proposed_date > c.lastWin)) {
              c.lastWin = tourn?.proposed_date ?? null;
            }
          }
          if (placement <= 3) c.podiums += 1;
          if (placement <= 4) c.top4s += 1;
        }
      }
    }

    const sortedChamps = Object.values(champMap).sort(
      (a, b) => b.wins - a.wins || b.podiums - a.podiums || b.top4s - a.top4s
    );

    setChampions(sortedChamps);
    setTournaments(
      tourneys.map(t => ({
        id: t.id,
        status: t.status,
        proposed_date: t.proposed_date ?? null,
        ff_signup_time: t.ff_signup_time ?? null,
        ff_start_time: t.ff_start_time ?? null,
        signup_qr_active: t.signup_qr_active ?? false,
        max_players: t.max_players ?? 32,
        registered_count: regCountMap[t.id] ?? 0,
        placements: placementsMap[t.id] ?? [],
      }))
    );
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { if (user) load(); }, [user]);

  async function openBracket(tournId: string, defaultTab = 1) {
    setViewBracketId(tournId);
    setViewBracketTab(defaultTab);
    setViewBracketLoading(true);
    setViewBracketData(null);
    const { data } = await supabase.rpc("rpc_ff_get_bracket", { p_tournament_id: tournId });
    if (data) {
      setViewBracketData(data as any);
      const rounds: BracketRound[] = (data as any)?.rounds ?? [];
      const activeRound = rounds.find(r => r.status === "in_progress") ?? rounds[rounds.length - 1];
      if (activeRound) setViewBracketTab(activeRound.round_number);
    }
    setViewBracketLoading(false);
  }

  if (authLoading || loading) {
    return <View style={st.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  const activeFF = tournaments.find(t => t.status === "upcoming" || t.status === "active");
  const completedFF = tournaments.filter(t => t.status === "completed");
  const isFull = activeFF ? activeFF.registered_count >= activeFF.max_players : false;

  return (
    <View style={st.root}>
      <SafeAreaView style={st.safe} edges={["top"]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#06b6d4" />}
        >
          {/* Header */}
          <View style={st.header}>
            <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={8}>
              <Ionicons name="chevron-back" size={20} color="#fff" />
            </Pressable>
            <View style={st.headerIcon}>
              <Ionicons name={"bowling-ball-outline" as any} size={20} color="#06b6d4" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.headerTitle}>First Friday Skee-Ball</Text>
              <Text style={st.headerSub}>Monthly tournament series</Text>
            </View>
          </View>

          <View style={st.content}>
            {/* Active / Upcoming Tournament */}
            {activeFF ? (
              <View style={st.activeCard}>
                <View style={st.activeCardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.activeCardDate}>{fmtLongDate(activeFF.proposed_date)}</Text>
                    <View style={[
                      st.activeStatusBadge,
                      activeFF.status === "active"
                        ? { backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.25)" }
                        : { backgroundColor: "rgba(6,182,212,0.1)", borderColor: "rgba(6,182,212,0.25)" },
                    ]}>
                      <View style={[st.activeStatusDot, { backgroundColor: activeFF.status === "active" ? "#22c55e" : "#06b6d4" }]} />
                      <Text style={[st.activeStatusText, { color: activeFF.status === "active" ? "#22c55e" : "#06b6d4" }]}>
                        {activeFF.status === "active" ? "TOURNAMENT IN PROGRESS" : "UPCOMING"}
                      </Text>
                    </View>
                  </View>
                </View>

                {(activeFF.ff_signup_time || activeFF.ff_start_time) && (
                  <View style={st.timesRow}>
                    {activeFF.ff_signup_time && (
                      <View style={st.timeChip}>
                        <Ionicons name="enter-outline" size={12} color="#06b6d4" />
                        <Text style={st.timeLabel}>Sign-up</Text>
                        <Text style={st.timeValue}>{activeFF.ff_signup_time}</Text>
                      </View>
                    )}
                    {activeFF.ff_start_time && (
                      <View style={[st.timeChip, { borderColor: "rgba(168,85,247,0.2)", backgroundColor: "rgba(168,85,247,0.07)" }]}>
                        <Ionicons name="play-outline" size={12} color="#a855f7" />
                        <Text style={[st.timeLabel, { color: "#a855f7" }]}>Start</Text>
                        <Text style={[st.timeValue, { color: "#a855f7" }]}>{activeFF.ff_start_time}</Text>
                      </View>
                    )}
                  </View>
                )}

                <View style={st.signupRow}>
                  <View style={st.playersChip}>
                    <Ionicons name="people-outline" size={12} color="#555" />
                    <Text style={st.playersText}>{activeFF.registered_count}/{activeFF.max_players} players</Text>
                  </View>
                  <View style={[
                    st.signupStatusChip,
                    isFull
                      ? { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.2)" }
                      : activeFF.signup_qr_active
                        ? { backgroundColor: "rgba(34,197,94,0.08)", borderColor: "rgba(34,197,94,0.2)" }
                        : { backgroundColor: "rgba(85,85,85,0.08)", borderColor: "rgba(85,85,85,0.2)" },
                  ]}>
                    <View style={[st.signupStatusDot, { backgroundColor: isFull ? "#ef4444" : activeFF.signup_qr_active ? "#22c55e" : "#444" }]} />
                    <Text style={[st.signupStatusText, { color: isFull ? "#ef4444" : activeFF.signup_qr_active ? "#22c55e" : "#444" }]}>
                      {isFull ? "FULL" : activeFF.signup_qr_active ? "SIGN-UP OPEN" : "SIGN-UP CLOSED"}
                    </Text>
                  </View>
                </View>

                <View style={st.inPersonRow}>
                  <Ionicons name="location-outline" size={13} color="#06b6d4" />
                  <Text style={st.inPersonText}>Sign up in person at the venue on the day of the event</Text>
                </View>

                {activeFF.status === "active" && (
                  <Pressable style={st.liveBracketBtn} onPress={() => openBracket(activeFF.id)}>
                    <View style={st.liveDot} />
                    <Text style={st.liveBracketText}>View Live Bracket</Text>
                    <Ionicons name="chevron-forward" size={14} color="#a855f7" />
                  </Pressable>
                )}
              </View>
            ) : (
              <View style={st.noActiveCard}>
                <Ionicons name="calendar-outline" size={28} color="#222" style={{ marginBottom: 10 }} />
                <Text style={st.noActiveTitle}>Next event coming soon</Text>
                <Text style={st.noActiveSub}>Check back closer to the first Friday of next month</Text>
              </View>
            )}

            {/* Hall of Champions */}
            {champions.length > 0 && (
              <View style={st.section}>
                <View style={st.sectionHeader}>
                  <Text style={st.sectionEmoji}>👑</Text>
                  <View>
                    <Text style={st.sectionTitle}>Hall of Champions</Text>
                    <Text style={st.sectionSub}>All-time standings across every event</Text>
                  </View>
                </View>

                {champions.map((c, i) => (
                  <View key={c.user_id} style={[st.champRow, i === 0 && st.champRowFirst]}>
                    <View style={st.champRankCol}>
                      {i === 0
                        ? <Text style={{ fontSize: 18 }}>👑</Text>
                        : <Text style={st.champRankNum}>#{i + 1}</Text>
                      }
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[st.champName, i === 0 && { color: "#f59e0b" }]}>{c.username}</Text>
                      {c.lastWin && (
                        <Text style={st.champLastWin}>Last won {fmtMonthYear(c.lastWin)}</Text>
                      )}
                    </View>
                    <View style={st.champStats}>
                      <View style={[st.champStatBadge, { backgroundColor: "rgba(245,158,11,0.12)", borderColor: "rgba(245,158,11,0.25)" }]}>
                        <Text style={{ fontSize: 11 }}>🏆</Text>
                        <Text style={[st.champStatNum, { color: "#f59e0b" }]}>{c.wins}</Text>
                      </View>
                      {c.top4s > 0 && (
                        <View style={st.champStatBadge}>
                          <Text style={{ fontSize: 10, color: "#8a8a8a" }}>Top 4</Text>
                          <Text style={st.champStatNum}>{c.top4s}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Past Tournaments */}
            {completedFF.length > 0 && (
              <View style={st.section}>
                <View style={st.sectionHeader}>
                  <Text style={st.sectionEmoji}>📋</Text>
                  <View>
                    <Text style={st.sectionTitle}>Tournament History</Text>
                    <Text style={st.sectionSub}>{completedFF.length} event{completedFF.length !== 1 ? "s" : ""} completed</Text>
                  </View>
                </View>

                {completedFF.map(t => (
                  <View key={t.id} style={st.histCard}>
                    <View style={st.histCardTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={st.histDate}>{fmtLongDate(t.proposed_date)}</Text>
                        <Text style={st.histLabel}>First Friday Skee-Ball</Text>
                      </View>
                      <Pressable style={st.histBracketBtn} onPress={() => openBracket(t.id, 4)}>
                        <Text style={st.histBracketBtnText}>Bracket</Text>
                        <Ionicons name="chevron-forward" size={11} color="#a855f7" />
                      </Pressable>
                    </View>
                    <View style={st.histPodium}>
                      {t.placements.slice(0, 4).map(p => (
                        <View key={p.placement} style={st.histPodiumRow}>
                          <Text style={st.histMedal}>{MEDALS[p.placement - 1] ?? `#${p.placement}`}</Text>
                          <Text style={[st.histUsername, p.placement === 1 && { color: "#fff", fontWeight: "800" }]}>
                            {p.username}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {completedFF.length === 0 && champions.length === 0 && (
              <View style={st.emptyCard}>
                <Text style={{ fontSize: 40, marginBottom: 12 }}>🎳</Text>
                <Text style={st.emptyTitle}>No history yet</Text>
                <Text style={st.emptySub}>Results will appear here once the first event completes.</Text>
              </View>
            )}

            <View style={{ height: 40 }} />
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Bracket viewer modal */}
      <Modal visible={viewBracketId !== null} transparent animationType="slide" onRequestClose={() => setViewBracketId(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setViewBracketId(null)} />
          <View style={{ backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 1, borderColor: "#1e1e1e", height: "92%" }}>
            <View style={st.bvHeader}>
              <View>
                <Text style={st.bvTitle}>Bracket</Text>
                {viewBracketData?.rounds?.some(r => r.status === "in_progress") && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                    <View style={st.bvLiveDot} />
                    <Text style={{ color: "#ef4444", fontSize: 11, fontWeight: "800" }}>LIVE</Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <Pressable onPress={() => viewBracketId && openBracket(viewBracketId, viewBracketTab)} style={{ padding: 8 }}>
                  <Ionicons name="refresh" size={18} color="#555" />
                </Pressable>
                <Pressable onPress={() => setViewBracketId(null)}>
                  <Ionicons name="close-circle" size={26} color="#444" />
                </Pressable>
              </View>
            </View>

            {viewBracketData?.rounds && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }} contentContainerStyle={st.bvRoundTabs}>
                {viewBracketData.rounds.map(r => (
                  <Pressable
                    key={r.round_number}
                    style={[st.bvRoundTab, viewBracketTab === r.round_number && st.bvRoundTabActive]}
                    onPress={() => setViewBracketTab(r.round_number)}
                  >
                    <Text style={[st.bvRoundTabText, viewBracketTab === r.round_number && { color: "#a855f7" }]}>{r.round_name}</Text>
                    <View style={[st.bvRoundDot, {
                      backgroundColor: r.status === "in_progress" ? "#f59e0b" : r.status === "completed" ? "#22c55e" : "#333",
                    }]} />
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {viewBracketLoading ? (
              <ActivityIndicator color="#a855f7" style={{ marginTop: 40 }} />
            ) : (
              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
                {(() => {
                  const finalRound = viewBracketData?.rounds?.find(r => r.round_number === 4);
                  if (finalRound?.status !== "completed") return null;
                  const winners = [...((finalRound?.groups?.[0]?.slots ?? []) as BracketSlot[])]
                    .filter(sl => sl.final_rank != null)
                    .sort((a, b) => (a.final_rank ?? 0) - (b.final_rank ?? 0));
                  if (winners.length === 0) return null;
                  return (
                    <View style={st.bvWinnersCard}>
                      <Text style={st.bvWinnersTitle}>🏆 Final Standings</Text>
                      {winners.map(w => (
                        <View key={w.seed} style={st.bvWinnerRow}>
                          <Text style={st.bvWinnerMedal}>
                            {w.final_rank === 1 ? "🥇" : w.final_rank === 2 ? "🥈" : w.final_rank === 3 ? "🥉" : "4️⃣"}
                          </Text>
                          <Text style={[st.bvWinnerName, w.final_rank === 1 && { color: "#f59e0b" }]}>{w.username}</Text>
                        </View>
                      ))}
                    </View>
                  );
                })()}

                {(() => {
                  const round = viewBracketData?.rounds?.find(r => r.round_number === viewBracketTab);
                  if (!round) return (
                    <Text style={{ color: "#777", textAlign: "center", marginTop: 40, fontSize: 14 }}>Round not yet started</Text>
                  );
                  return (round.groups ?? []).map(g => (
                    <View key={g.id} style={st.bvGroupCard}>
                      <View style={st.bvGroupHeader}>
                        <Text style={st.bvGroupTitle}>Group {g.group_number}</Text>
                        <View style={[st.bvGroupBadge, {
                          backgroundColor: g.status === "completed" ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)",
                          borderColor: g.status === "completed" ? "rgba(34,197,94,0.3)" : "rgba(245,158,11,0.3)",
                        }]}>
                          <Text style={{ color: g.status === "completed" ? "#22c55e" : "#f59e0b", fontSize: 10, fontWeight: "800" }}>
                            {g.status === "completed" ? "DONE" : g.status === "game2" ? "GAME 2" : "GAME 1"}
                          </Text>
                        </View>
                      </View>
                      {(g.slots ?? []).map(sl => (
                        <View key={`${sl.user_id}_${sl.seed}`} style={st.bvSlotRow}>
                          <Ionicons
                            name={sl.status === "eliminated" ? "close-circle" : sl.status === "advanced" ? "checkmark-circle" : "ellipse"}
                            size={14}
                            color={sl.status === "eliminated" ? "#ef4444" : sl.status === "advanced" ? "#22c55e" : "#555"}
                          />
                          <Text style={[st.bvSlotName, sl.status === "eliminated" && { color: "#333", textDecorationLine: "line-through" }]}>
                            {sl.username}
                          </Text>
                          {sl.final_rank != null && <Text style={st.bvSlotRank}>#{sl.final_rank}</Text>}
                          {sl.eliminated_game != null && <Text style={st.bvSlotElim}>out g{sl.eliminated_game}</Text>}
                        </View>
                      ))}
                      {(g.games ?? []).filter(gm => gm.status === "completed" && gm.scores).map(gm => (
                        <View key={gm.id} style={st.bvGameResult}>
                          <Text style={st.bvGameResultLabel}>Game {gm.game_number}</Text>
                          {(gm.scores ?? []).map((sc, idx) => (
                            <Text key={`${sc.user_id}_${idx}`} style={[st.bvGameScore, sc.is_eliminated && { color: "#ef4444" }]}>
                              {sc.username}: {sc.score.toLocaleString()}{sc.is_eliminated ? "  ✗" : ""}
                            </Text>
                          ))}
                        </View>
                      ))}
                    </View>
                  ));
                })()}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  safe: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },

  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 16 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#111", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#1e1e1e" },
  headerIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(6,182,212,0.1)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(6,182,212,0.2)" },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },
  headerSub: { color: "#777", fontSize: 12, marginTop: 1 },

  content: { paddingHorizontal: 18 },

  // Active/upcoming card
  activeCard: { backgroundColor: "rgba(6,182,212,0.05)", borderRadius: 20, borderWidth: 1, borderColor: "rgba(6,182,212,0.2)", padding: 18, marginBottom: 20 },
  activeCardTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 14 },
  activeCardDate: { color: "#fff", fontSize: 18, fontWeight: "900", marginBottom: 6 },
  activeStatusBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1 },
  activeStatusDot: { width: 6, height: 6, borderRadius: 3 },
  activeStatusText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },

  timesRow: { flexDirection: "row", gap: 10, marginBottom: 12, flexWrap: "wrap" },
  timeChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(6,182,212,0.07)", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: "rgba(6,182,212,0.18)" },
  timeLabel: { color: "#06b6d4", fontSize: 11, fontWeight: "700" },
  timeValue: { color: "#06b6d4", fontSize: 12, fontWeight: "900" },

  signupRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" },
  playersChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#0d0d0d", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: "#1a1a1a" },
  playersText: { color: "#8a8a8a", fontSize: 12, fontWeight: "600" },
  signupStatusChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1 },
  signupStatusDot: { width: 6, height: 6, borderRadius: 3 },
  signupStatusText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },

  inPersonRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  inPersonText: { color: "#06b6d4", fontSize: 12, fontWeight: "600", flex: 1 },

  liveBracketBtn: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, backgroundColor: "rgba(168,85,247,0.08)", borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: "rgba(168,85,247,0.2)" },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ef4444" },
  liveBracketText: { flex: 1, color: "#a855f7", fontSize: 13, fontWeight: "800" },

  noActiveCard: { backgroundColor: "#0d0d0d", borderRadius: 20, padding: 32, alignItems: "center", borderWidth: 1, borderColor: "#1a1a1a", marginBottom: 20 },
  noActiveTitle: { color: "#fff", fontSize: 16, fontWeight: "800", marginBottom: 6 },
  noActiveSub: { color: "#777", fontSize: 13, textAlign: "center" },

  // Section
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  sectionEmoji: { fontSize: 22 },
  sectionTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },
  sectionSub: { color: "#777", fontSize: 12, marginTop: 1 },

  // Champion rows
  champRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#0d0d0d", borderRadius: 14, padding: 14, marginBottom: 6, borderWidth: 1, borderColor: "#1a1a1a" },
  champRowFirst: { backgroundColor: "rgba(245,158,11,0.06)", borderColor: "rgba(245,158,11,0.2)" },
  champRankCol: { width: 32, alignItems: "center" },
  champRankNum: { color: "#333", fontSize: 13, fontWeight: "800" },
  champName: { color: "#ccc", fontSize: 15, fontWeight: "800" },
  champLastWin: { color: "#777", fontSize: 11, marginTop: 2 },
  champStats: { flexDirection: "row", gap: 6, alignItems: "center" },
  champStatBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#111", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: "#1e1e1e" },
  champStatNum: { color: "#8a8a8a", fontSize: 12, fontWeight: "800" },

  // History cards
  histCard: { backgroundColor: "#0d0d0d", borderRadius: 16, borderWidth: 1, borderColor: "#1a1a1a", marginBottom: 8, overflow: "hidden" },
  histCardTop: { flexDirection: "row", alignItems: "center", padding: 14, paddingBottom: 10 },
  histDate: { color: "#fff", fontSize: 14, fontWeight: "800" },
  histLabel: { color: "#777", fontSize: 11, marginTop: 2 },
  histBracketBtn: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(168,85,247,0.08)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: "rgba(168,85,247,0.2)" },
  histBracketBtnText: { color: "#a855f7", fontSize: 12, fontWeight: "700" },
  histPodium: { paddingHorizontal: 14, paddingBottom: 14, gap: 4 },
  histPodiumRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  histMedal: { fontSize: 14, width: 22 },
  histUsername: { color: "#888", fontSize: 13 },

  // Empty state
  emptyCard: { backgroundColor: "#0d0d0d", borderRadius: 20, padding: 40, alignItems: "center", borderWidth: 1, borderColor: "#1a1a1a", marginBottom: 20 },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "900", marginBottom: 6 },
  emptySub: { color: "#777", fontSize: 13, textAlign: "center", lineHeight: 20 },

  // Bracket viewer
  bvHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16 },
  bvTitle: { color: "#fff", fontSize: 20, fontWeight: "900" },
  bvLiveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#ef4444" },
  bvRoundTabs: { flexDirection: "row", paddingHorizontal: 16, gap: 6, paddingBottom: 4 },
  bvRoundTab: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: "#0f0f0f", borderWidth: 1, borderColor: "#1a1a1a" },
  bvRoundTabActive: { backgroundColor: "rgba(168,85,247,0.12)", borderColor: "rgba(168,85,247,0.3)" },
  bvRoundTabText: { color: "#777", fontSize: 11, fontWeight: "700" },
  bvRoundDot: { width: 6, height: 6, borderRadius: 3 },
  bvWinnersCard: { backgroundColor: "rgba(168,85,247,0.08)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(168,85,247,0.2)", padding: 18, marginBottom: 20 },
  bvWinnersTitle: { color: "#fff", fontSize: 18, fontWeight: "900", textAlign: "center", marginBottom: 14 },
  bvWinnerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(168,85,247,0.1)" },
  bvWinnerMedal: { fontSize: 24, width: 36, textAlign: "center" },
  bvWinnerName: { color: "#fff", fontSize: 15, fontWeight: "700", flex: 1 },
  bvGroupCard: { backgroundColor: "#0d0d0d", borderRadius: 16, borderWidth: 1, borderColor: "#1a1a1a", marginBottom: 12, overflow: "hidden" },
  bvGroupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#111", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e1e1e" },
  bvGroupTitle: { color: "#fff", fontSize: 13, fontWeight: "800" },
  bvGroupBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  bvSlotRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#141414" },
  bvSlotName: { flex: 1, color: "#ccc", fontSize: 13, fontWeight: "600" },
  bvSlotRank: { color: "#a855f7", fontSize: 11, fontWeight: "800" },
  bvSlotElim: { color: "#333", fontSize: 10, fontWeight: "700" },
  bvGameResult: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "rgba(0,0,0,0.2)", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#141414" },
  bvGameResultLabel: { color: "#a855f7", fontSize: 10, fontWeight: "800", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.6 },
  bvGameScore: { color: "#666", fontSize: 12, marginVertical: 1 },
});
