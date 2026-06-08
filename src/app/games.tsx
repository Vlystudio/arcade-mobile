import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomTabBar from "../components/bottom-tab-bar";
import { useLocation } from "../context/location-context";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

type Game = { id: string; name: string; type: string; description: string | null; machines_count: number };
type BestScore = { game_id: string; score: number; count: number };
type Lane = { id: string; lane_number: number; status: string };

export default function GamesScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const { isVinyl } = useLocation();
  const [games, setGames] = useState<Game[]>([]);
  const [bestScores, setBestScores] = useState<Record<string, BestScore>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [laneGame, setLaneGame] = useState<Game | null>(null);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [lanesLoading, setLanesLoading] = useState(false);
  const [groupModal, setGroupModal] = useState<"arcade" | "pinball" | null>(null);

  const skeeballGame = games.find((g) => g.type === "skeeball") ?? null;
  const arcadeGames  = games.filter((g) => g.type === "arcade");
  const pinballGames = games.filter((g) => g.type === "pinball");
  const otherGames   = games.filter((g) => !["skeeball", "arcade", "pinball"].includes(g.type));

  async function loadGames() {
    if (!user) return;
    const [gamesRes, scoresRes] = await Promise.all([
      supabase.from("games").select("*").order("name"),
      supabase.from("scores").select("game_id, score").eq("user_id", user.id).eq("status", "approved"),
    ]);
    if (gamesRes.data) setGames(gamesRes.data);
    if (scoresRes.data) {
      const byGame: Record<string, BestScore> = {};
      for (const s of scoresRes.data) {
        if (!byGame[s.game_id]) byGame[s.game_id] = { game_id: s.game_id, score: s.score, count: 0 };
        byGame[s.game_id].count += 1;
        if (s.score > byGame[s.game_id].score) byGame[s.game_id].score = s.score;
      }
      setBestScores(byGame);
    }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { if (user) loadGames(); }, [user]);

  async function openLaneModal(game: Game) {
    setLaneGame(game);
    setLanesLoading(true);
    const { data } = await supabase
      .from("lanes").select("id, lane_number, status")
      .eq("game_id", game.id).order("lane_number");
    setLanes(data ?? []);
    setLanesLoading(false);
  }

  function submitScore(game: Game, lane?: Lane) {
    router.push({
      pathname: "/submit-score",
      params: {
        game_id: game.id,
        game_name: game.name,
        game_type: game.type,
        lane_id: lane?.id ?? "",
        lane_number: lane ? String(lane.lane_number) : "",
        check_in_id: "",
      },
    } as any);
  }

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  const groupGames = groupModal === "arcade" ? arcadeGames : pinballGames;
  const groupColor = groupModal === "arcade" ? "#f59e0b" : "#a855f7";
  const groupTitle = groupModal === "arcade" ? "Arcade Games" : "Pinball Machines";

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadGames(); }} tintColor="#06b6d4" />
          }
        >
          {/* Header */}
          <View style={styles.pageHeader}>
            <Text style={styles.pageTitle}>Games</Text>
            <Text style={styles.pageSub}>Track your scores across every machine</Text>
          </View>

          {/* Stats strip */}
          <View style={styles.summaryStrip}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{games.length}</Text>
              <Text style={styles.summaryLabel}>Machines</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{Object.keys(bestScores).length}</Text>
              <Text style={styles.summaryLabel}>Played</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{Object.values(bestScores).reduce((a, b) => a + b.count, 0)}</Text>
              <Text style={styles.summaryLabel}>Total Plays</Text>
            </View>
          </View>

          {/* Pool Hall — Vinyl Hall only */}
          {isVinyl && (
            <Pressable style={styles.poolCard} onPress={() => router.push("/pool" as any)}>
              <View style={styles.poolCardLeft}>
                <View style={styles.poolIconWrap}>
                  <Ionicons name="disc-outline" size={26} color="#a855f7" />
                </View>
                <View>
                  <Text style={styles.poolCardTitle}>Pool Hall</Text>
                  <Text style={styles.poolCardSub}>Claim a table · Track your games</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#a855f7" />
            </Pressable>
          )}

          {games.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="game-controller-outline" size={32} color="#333" />
              </View>
              <Text style={styles.emptyTitle}>No games yet</Text>
              <Text style={styles.emptySub}>Run seed-games.sql in Supabase to populate machines.</Text>
            </View>
          ) : (
            <>
              {/* ─── Skee-Ball ─── */}
              {skeeballGame && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>SKEE-BALL</Text>
                  <Pressable style={styles.skeeCard} onPress={() => openLaneModal(skeeballGame)}>
                    <View style={styles.skeeLeft}>
                      <View style={styles.skeeIconWrap}>
                        <Ionicons name={"bowling-ball-outline" as any} size={30} color="#06b6d4" />
                      </View>
                      <View>
                        <Text style={styles.skeeName}>Skee-Ball</Text>
                        <Text style={styles.skeeLaneCount}>{skeeballGame.machines_count} lanes</Text>
                      </View>
                    </View>
                    <View style={styles.skeeRight}>
                      {bestScores[skeeballGame.id] && (
                        <View style={styles.skeeStat}>
                          <Text style={styles.skeeStatLabel}>YOUR BEST</Text>
                          <Text style={styles.skeeStatValue}>
                            {bestScores[skeeballGame.id].score.toLocaleString()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.skeeCta}>
                        <Text style={styles.skeeCtaText}>Choose Lane</Text>
                        <Ionicons name="arrow-forward" size={14} color="#000" />
                      </View>
                    </View>
                  </Pressable>
                </View>
              )}

              {/* ─── Arcade ─── */}
              {arcadeGames.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>ARCADE</Text>
                  <Pressable style={styles.groupCard} onPress={() => setGroupModal("arcade")}>
                    <View style={[styles.groupIconWrap, { backgroundColor: "#f59e0b18" }]}>
                      <Ionicons name="game-controller-outline" size={26} color="#f59e0b" />
                    </View>
                    <View style={styles.groupInfo}>
                      <Text style={styles.groupTitle}>Arcade Games</Text>
                      <Text style={styles.groupCount}>{arcadeGames.length} machines · Photo proof required</Text>
                    </View>
                    <View style={[styles.groupArrow, { backgroundColor: "#f59e0b18" }]}>
                      <Ionicons name="chevron-forward" size={16} color="#f59e0b" />
                    </View>
                  </Pressable>
                </View>
              )}

              {/* ─── Pinball ─── */}
              {pinballGames.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>PINBALL</Text>
                  <Pressable style={styles.groupCard} onPress={() => setGroupModal("pinball")}>
                    <View style={[styles.groupIconWrap, { backgroundColor: "#a855f718" }]}>
                      <Ionicons name="radio-outline" size={26} color="#a855f7" />
                    </View>
                    <View style={styles.groupInfo}>
                      <Text style={styles.groupTitle}>Pinball Machines</Text>
                      <Text style={styles.groupCount}>{pinballGames.length} machines · Photo proof required</Text>
                    </View>
                    <View style={[styles.groupArrow, { backgroundColor: "#a855f718" }]}>
                      <Ionicons name="chevron-forward" size={16} color="#a855f7" />
                    </View>
                  </Pressable>
                </View>
              )}

              {/* ─── Other (air hockey, basketball, etc.) ─── */}
              {otherGames.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>OTHER</Text>
                  {otherGames.map((game) => {
                    const color = gameColor(game.type);
                    const best  = bestScores[game.id];
                    return (
                      <View key={game.id} style={styles.otherCard}>
                        <View style={[styles.otherIconWrap, { backgroundColor: color + "18" }]}>
                          <Ionicons name={gameIcon(game.type)} size={20} color={color} />
                        </View>
                        <View style={styles.otherInfo}>
                          <Text style={styles.otherName}>{game.name}</Text>
                          <Text style={styles.otherMeta}>
                            {game.machines_count} {game.machines_count === 1 ? "machine" : "machines"}
                            {best ? ` · Best: ${best.score.toLocaleString()}` : ""}
                          </Text>
                        </View>
                        <Pressable
                          style={[styles.otherBtn, { borderColor: color + "55", backgroundColor: color + "12" }]}
                          onPress={() => { submitScore(game); }}
                        >
                          <Text style={[styles.otherBtnText, { color }]}>+ Score</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}

          {/* Trivia Night entry */}
          <Pressable style={styles.triviaCard} onPress={() => router.push("/trivia" as any)}>
            <View style={styles.triviaCardLeft}>
              <View style={styles.triviaIconWrap}>
                <Ionicons name="help-circle-outline" size={26} color="#f59e0b" />
              </View>
              <View>
                <Text style={styles.triviaCardTitle}>Trivia Night</Text>
                <Text style={styles.triviaCardSub}>Sign up your team · Min. 3 players</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#f59e0b" />
          </Pressable>

          <Pressable style={styles.tourneysCard} onPress={() => router.push("/tournaments" as any)}>
            <View style={styles.triviaCardLeft}>
              <View style={styles.tourneysIconWrap}>
                <Ionicons name="trophy-outline" size={26} color="#22c55e" />
              </View>
              <View>
                <Text style={styles.tourneysCardTitle}>Tournaments</Text>
                <Text style={styles.tourneysCardSub}>First Fridays · Brackets · Prizes</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#22c55e" />
          </Pressable>

          <Pressable style={styles.leaderLink} onPress={() => router.push("/leaderboard")}>
            <Ionicons name="podium-outline" size={16} color="#06b6d4" />
            <Text style={styles.leaderLinkText}>View Leaderboard</Text>
            <Ionicons name="chevron-forward" size={14} color="#06b6d4" />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
      <BottomTabBar />

      {/* ── Lane picker modal ── */}
      <Modal visible={!!laneGame} transparent animationType="slide" onRequestClose={() => setLaneGame(null)}>
        <View style={styles.modalBg}>
          <Pressable style={styles.modalDismiss} onPress={() => setLaneGame(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Skee-Ball Lanes</Text>
            <Text style={styles.modalSub}>View top scores or submit a new score for any lane</Text>

            {lanesLoading ? (
              <ActivityIndicator color="#06b6d4" style={{ marginVertical: 24 }} />
            ) : lanes.length === 0 ? (
              <Text style={styles.emptyText}>No lanes found. Run seed-games.sql in Supabase.</Text>
            ) : (
              <View style={styles.lanesGrid}>
                {lanes.map((lane) => {
                  const occupied = lane.status === "occupied";
                  return (
                    <View key={lane.id} style={styles.laneCard}>
                      <View style={styles.laneTop}>
                        <Text style={styles.laneNumber}>{lane.lane_number}</Text>
                        <View style={[styles.laneStatusDot, { backgroundColor: occupied ? "#ef4444" : "#22c55e" }]} />
                      </View>
                      <Text style={[styles.laneStatusText, { color: occupied ? "#ef4444" : "#22c55e" }]}>
                        {occupied ? "Occupied" : "Open"}
                      </Text>
                      <Pressable
                        style={styles.laneScoresBtn}
                        onPress={() => {
                          setLaneGame(null);
                          router.push(`/lane-scores?lane_id=${lane.id}&lane_number=${lane.lane_number}` as any);
                        }}
                      >
                        <Ionicons name="trophy-outline" size={11} color="#06b6d4" />
                        <Text style={styles.laneScoresBtnText}>Top Scores</Text>
                      </Pressable>
                      <Pressable
                        style={styles.laneSubmitBtn}
                        onPress={() => {
                          setLaneGame(null);
                          submitScore(laneGame!, lane);
                        }}
                      >
                        <Ionicons name="add" size={11} color="#fff" />
                        <Text style={styles.laneSubmitBtnText}>Submit Score</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Arcade / Pinball group modal ── */}
      <Modal visible={!!groupModal} transparent animationType="slide" onRequestClose={() => setGroupModal(null)}>
        <View style={styles.modalBg}>
          <Pressable style={styles.modalDismiss} onPress={() => setGroupModal(null)} />
          <View style={[styles.modalSheet, { paddingBottom: 0 }]}>
            <View style={styles.modalHandle} />
            <View style={[styles.groupModalTop, { borderBottomColor: groupColor + "25" }]}>
              <View style={[styles.groupModalIconWrap, { backgroundColor: groupColor + "18" }]}>
                <Ionicons
                  name={groupModal === "arcade" ? "game-controller-outline" : "radio-outline"}
                  size={22} color={groupColor}
                />
              </View>
              <View>
                <Text style={styles.modalTitle}>{groupTitle}</Text>
                <Text style={styles.modalSub}>{groupGames.length} machines · Tap + to submit score</Text>
              </View>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              style={styles.groupList}
              contentContainerStyle={{ paddingBottom: 36 }}
            >
              {groupGames.map((game, i) => {
                const best = bestScores[game.id];
                return (
                  <View
                    key={game.id}
                    style={[styles.groupRow, i < groupGames.length - 1 && styles.groupRowBorder]}
                  >
                    <View style={styles.groupRowInfo}>
                      <Text style={styles.groupRowName}>{game.name}</Text>
                      {best ? (
                        <Text style={[styles.groupRowBest, { color: groupColor }]}>
                          Best: {best.score.toLocaleString()} · {best.count} {best.count === 1 ? "play" : "plays"}
                        </Text>
                      ) : (
                        <Text style={styles.groupRowUnplayed}>Not played yet</Text>
                      )}
                    </View>
                    <Pressable
                      style={[styles.groupRowBtn, { backgroundColor: groupColor }]}
                      onPress={() => {
                        setGroupModal(null);
                        submitScore(game);
                      }}
                    >
                      <Ionicons name="add" size={20} color="#000" />
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function gameColor(type: string) {
  const m: Record<string, string> = { skeeball: "#06b6d4", pinball: "#a855f7", arcade: "#f59e0b", basketball: "#f97316", airhockey: "#22c55e" };
  return m[type] ?? "#888";
}

function gameIcon(type: string): React.ComponentProps<typeof Ionicons>["name"] {
  const m: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
    skeeball: "bowling-ball-outline" as any,
    pinball: "radio-outline",
    arcade: "game-controller-outline",
    basketball: "basketball-outline",
    airhockey: "disc-outline",
  };
  return m[type] ?? "game-controller-outline";
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  safe: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28 },

  pageHeader: { marginBottom: 20 },
  pageTitle: { color: "#fff", fontSize: 32, fontWeight: "900", letterSpacing: -0.5 },
  pageSub: { color: "#555", fontSize: 14, marginTop: 2 },

  summaryStrip: {
    flexDirection: "row", backgroundColor: "#111",
    borderRadius: 16, borderWidth: 1, borderColor: "#1e1e1e",
    paddingVertical: 16, marginBottom: 22,
  },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryValue: { color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  summaryLabel: { color: "#444", fontSize: 11, fontWeight: "600", marginTop: 2 },
  summaryDivider: { width: StyleSheet.hairlineWidth, backgroundColor: "#222" },

  poolCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(168,85,247,0.07)", borderRadius: 20,
    padding: 18, marginBottom: 24,
    borderWidth: 1, borderColor: "rgba(168,85,247,0.22)",
  },
  poolCardLeft: { flexDirection: "row", alignItems: "center", gap: 14 },
  poolIconWrap: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: "rgba(168,85,247,0.14)", alignItems: "center", justifyContent: "center",
  },
  poolCardTitle: { color: "#fff", fontSize: 16, fontWeight: "900", marginBottom: 2 },
  poolCardSub: { color: "#a855f7", fontSize: 12, fontWeight: "600" },

  emptyCard: {
    backgroundColor: "#111", borderRadius: 22, padding: 44, alignItems: "center",
    borderWidth: 1, borderColor: "#1e1e1e", gap: 10,
  },
  emptyIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "#161616", borderWidth: 1, borderColor: "#222",
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  emptySub: { color: "#555", fontSize: 14, textAlign: "center" },

  section: { marginBottom: 24 },
  sectionLabel: {
    color: "#333", fontSize: 11, fontWeight: "800",
    letterSpacing: 1.4, marginBottom: 10,
  },

  // Skee-Ball featured card
  skeeCard: {
    backgroundColor: "rgba(6,182,212,0.07)", borderRadius: 22,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.2)",
    padding: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  skeeLeft: { flexDirection: "row", alignItems: "center", gap: 14 },
  skeeIconWrap: {
    width: 54, height: 54, borderRadius: 16,
    backgroundColor: "rgba(6,182,212,0.14)", alignItems: "center", justifyContent: "center",
  },
  skeeName: { color: "#fff", fontSize: 20, fontWeight: "900", letterSpacing: -0.3 },
  skeeLaneCount: { color: "#06b6d4", fontSize: 13, fontWeight: "600", marginTop: 2 },
  skeeRight: { alignItems: "flex-end", gap: 10 },
  skeeStat: { alignItems: "flex-end" },
  skeeStatLabel: { color: "#06b6d4", fontSize: 9, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  skeeStatValue: { color: "#fff", fontSize: 20, fontWeight: "900" },
  skeeCta: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#06b6d4", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  skeeCtaText: { color: "#000", fontWeight: "900", fontSize: 13 },

  // Group cards (Arcade / Pinball)
  groupCard: {
    backgroundColor: "#111", borderRadius: 20,
    borderWidth: 1, borderColor: "#1e1e1e",
    flexDirection: "row", alignItems: "center", padding: 18, gap: 14,
  },
  groupIconWrap: { width: 50, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  groupInfo: { flex: 1 },
  groupTitle: { color: "#fff", fontSize: 17, fontWeight: "900", marginBottom: 3 },
  groupCount: { color: "#555", fontSize: 12 },
  groupArrow: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },

  // Other games
  otherCard: {
    backgroundColor: "#111", borderRadius: 18,
    borderWidth: 1, borderColor: "#1e1e1e",
    flexDirection: "row", alignItems: "center", padding: 14, gap: 12, marginBottom: 8,
  },
  otherIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  otherInfo: { flex: 1 },
  otherName: { color: "#fff", fontSize: 15, fontWeight: "800", marginBottom: 2 },
  otherMeta: { color: "#555", fontSize: 12 },
  otherBtn: {
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  otherBtnText: { fontSize: 13, fontWeight: "800" },

  leaderLink: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 22,
  },
  leaderLinkText: { color: "#06b6d4", fontWeight: "700", fontSize: 14 },

  // Shared modal shell
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.82)", justifyContent: "flex-end" },
  modalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  modalSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 36, borderTopWidth: 1, borderColor: "#222",
    maxHeight: "88%",
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 20 },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "900", letterSpacing: -0.3, marginBottom: 2 },
  modalSub: { color: "#555", fontSize: 13, marginBottom: 20 },
  emptyText: { color: "#444", fontSize: 14, textAlign: "center", paddingVertical: 20 },

  // Lane grid (inside lane modal)
  lanesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  laneCard: {
    width: "30%", flexGrow: 1,
    backgroundColor: "#0d0d0d", borderRadius: 18,
    padding: 14, alignItems: "center", gap: 7,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  laneTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  laneNumber: { color: "#fff", fontSize: 30, fontWeight: "900", letterSpacing: -1 },
  laneStatusDot: { width: 8, height: 8, borderRadius: 4 },
  laneStatusText: { fontSize: 11, fontWeight: "700" },
  laneScoresBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(6,182,212,0.1)", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.2)", width: "100%", justifyContent: "center",
  },
  laneScoresBtnText: { color: "#06b6d4", fontSize: 11, fontWeight: "700" },
  laneSubmitBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#1e1e1e", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: "#2a2a2a", width: "100%", justifyContent: "center",
  },
  laneSubmitBtnText: { color: "#ccc", fontSize: 11, fontWeight: "700" },

  // Group game list (inside arcade/pinball modal)
  groupModalTop: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingBottom: 18, marginBottom: 4, borderBottomWidth: 1,
  },
  groupModalIconWrap: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  groupList: { flex: 1 },
  groupRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 14, gap: 12,
  },
  groupRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e1e1e" },
  groupRowInfo: { flex: 1 },
  groupRowName: { color: "#fff", fontSize: 15, fontWeight: "800", marginBottom: 3 },
  groupRowBest: { fontSize: 12, fontWeight: "600" },
  groupRowUnplayed: { color: "#333", fontSize: 12 },
  groupRowBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center",
  },

  triviaCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(245,158,11,0.07)", borderRadius: 20,
    padding: 18, marginBottom: 12,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.22)",
  },
  triviaCardLeft: { flexDirection: "row", alignItems: "center", gap: 14 },
  triviaIconWrap: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: "rgba(245,158,11,0.14)", alignItems: "center", justifyContent: "center",
  },
  triviaCardTitle: { color: "#fff", fontSize: 16, fontWeight: "900", marginBottom: 2 },
  triviaCardSub:   { color: "#f59e0b", fontSize: 12, fontWeight: "600" },

  tourneysCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(34,197,94,0.07)", borderRadius: 20,
    padding: 18, marginBottom: 12,
    borderWidth: 1, borderColor: "rgba(34,197,94,0.22)",
  },
  tourneysIconWrap: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: "rgba(34,197,94,0.14)", alignItems: "center", justifyContent: "center",
  },
  tourneysCardTitle: { color: "#fff", fontSize: 16, fontWeight: "900", marginBottom: 2 },
  tourneysCardSub:   { color: "#22c55e", fontSize: 12, fontWeight: "600" },
});
