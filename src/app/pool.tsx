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
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/avatar";
import BottomTabBar from "../components/bottom-tab-bar";
import { useRequireAuth } from "../hooks/use-require-auth";
import { reportError } from "../lib/report-error";
import { supabase } from "../../lib/supabase";

type PoolTable = {
  id: string;
  table_number: number;
  name: string | null;
  status: "available" | "occupied";
  current_game_id: string | null;
  players: string[];
};

type GameType = "8ball" | "9ball" | "cutthroat" | "straight";
type RecentGame = {
  id: string;
  table_number: number;
  game_type: GameType;
  player_names: string[];
  winner_name: string | null;
  created_at: string;
};
type UserResult = { id: string; username: string; avatar_url: string | null };

const GAME_TYPES: { key: GameType; label: string; icon: string; desc: string; players: string }[] = [
  { key: "8ball", label: "8-Ball", icon: "ellipse", desc: "Classic solids vs stripes", players: "2 players" },
  { key: "9ball", label: "9-Ball", icon: "radio-button-on", desc: "Shoot lowest ball first", players: "2 players" },
  { key: "cutthroat", label: "Cutthroat", icon: "triangle", desc: "Defend your group", players: "3 players" },
  { key: "straight", label: "Straight", icon: "remove", desc: "Call every shot", players: "2 players" },
];

export default function PoolScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [tables, setTables] = useState<PoolTable[]>([]);
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myStats, setMyStats] = useState({ wins: 0, losses: 0, total: 0 });

  // Start game modal
  const [startModal, setStartModal] = useState(false);
  const [selectedTable, setSelectedTable] = useState<PoolTable | null>(null);
  const [gameType, setGameType] = useState<GameType>("8ball");
  const [opponentSearch, setOpponentSearch] = useState("");
  const [opponentResults, setOpponentResults] = useState<UserResult[]>([]);
  const [opponents, setOpponents] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // End game modal
  const [endModal, setEndModal] = useState<PoolTable | null>(null);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  async function loadData() {
    if (!user) return;

    const [tablesRes, gamesRes, statsRes] = await Promise.all([
      supabase.from("pool_tables").select("id, table_number, name, status, current_game_id").order("table_number"),
      supabase
        .from("pool_games")
        .select("id, table_id, game_type, created_at, winner_id, pool_tables(table_number), pool_game_players(user_id, profiles(username))")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase.from("pool_games").select("winner_id, id").in("status", ["completed"]).or(`pool_game_players.user_id.eq.${user.id}`),
    ]);

    // Enrich tables with players
    const tableList: PoolTable[] = [];
    for (const t of tablesRes.data ?? []) {
      let players: string[] = [];
      if (t.current_game_id) {
        const { data: pgp } = await supabase
          .from("pool_game_players")
          .select("profiles(username)")
          .eq("game_id", t.current_game_id);
        players = (pgp ?? []).map((p: any) => (Array.isArray(p.profiles) ? p.profiles[0]?.username : p.profiles?.username) ?? "?");
      }
      tableList.push({ ...t, players });
    }
    setTables(tableList);

    // Recent games
    const recent: RecentGame[] = (gamesRes.data ?? []).map((g: any) => {
      const tbl = Array.isArray(g.pool_tables) ? g.pool_tables[0] : g.pool_tables;
      const playerNames = (g.pool_game_players ?? []).map((p: any) =>
        Array.isArray(p.profiles) ? p.profiles[0]?.username : p.profiles?.username ?? "?"
      );
      return {
        id: g.id,
        table_number: tbl?.table_number ?? 0,
        game_type: g.game_type,
        player_names: playerNames,
        winner_name: null,
        created_at: g.created_at,
      };
    });
    setRecentGames(recent);

    // My stats from pool_games where I was a player
    const { data: myGames } = await supabase
      .from("pool_games")
      .select("id, winner_id")
      .eq("status", "completed")
      .in("id", (await supabase.from("pool_game_players").select("game_id").eq("user_id", user.id)).data?.map(p => p.game_id) ?? []);
    const wins = (myGames ?? []).filter(g => g.winner_id === user.id).length;
    const total = (myGames ?? []).length;
    setMyStats({ wins, losses: total - wins, total });

    setLoading(false);
    setRefreshing(false);
  }

  async function searchOpponents(text: string) {
    if (!text.trim() || !user) { setOpponentResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .ilike("username", `%${text.trim()}%`)
      .neq("id", user.id)
      .limit(6);
    setOpponentResults((data ?? []).filter(u => !opponents.find(o => o.id === u.id)));
    setSearching(false);
  }

  async function handleStartGame() {
    if (!user || !selectedTable) return;
    const maxPlayers = gameType === "cutthroat" ? 3 : 2;
    if (opponents.length === 0) { setStartError("Add at least one opponent."); return; }
    if (opponents.length >= maxPlayers) { setStartError(`${gameType === "cutthroat" ? "Cutthroat" : "This game"} needs max ${maxPlayers} players total.`); return; }

    setStartError(null);
    setStarting(true);

    const { data: game, error: gameErr } = await supabase
      .from("pool_games")
      .insert({ table_id: selectedTable.id, game_type: gameType, status: "active" })
      .select("id")
      .single();

    if (gameErr || !game) {
      const msg = gameErr?.message ?? "Could not start game.";
      reportError("Pool.handleStartGame", msg);
      setStartError(msg);
      setStarting(false);
      return;
    }

    const players = [{ game_id: game.id, user_id: user.id }, ...opponents.map(o => ({ game_id: game.id, user_id: o.id }))];
    await supabase.from("pool_game_players").insert(players);
    await supabase.from("pool_tables").update({ status: "occupied", current_game_id: game.id }).eq("id", selectedTable.id);

    setStarting(false);
    setStartModal(false);
    setOpponents([]);
    setOpponentSearch("");
    setGameType("8ball");
    await loadData();
  }

  async function handleEndGame(table: PoolTable) {
    if (!winnerId || !table.current_game_id) return;
    setEnding(true);
    await supabase.from("pool_games").update({ status: "completed", winner_id: winnerId, completed_at: new Date().toISOString() }).eq("id", table.current_game_id);
    await supabase.from("pool_tables").update({ status: "available", current_game_id: null }).eq("id", table.id);
    setEnding(false);
    setEndModal(null);
    setWinnerId(null);
    await loadData();
  }

  useEffect(() => { if (user) loadData(); }, [user]);

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#a855f7" /></View>;
  }

  const availableCount = tables.filter(t => t.status === "available").length;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor="#a855f7" />}
        >
          <View style={styles.content}>
            {/* Header */}
            <View style={styles.pageHeader}>
              <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/games" as any)}>
                <Ionicons name="chevron-back" size={22} color="#fff" />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.pageTitle}>Pool Hall</Text>
                <Text style={styles.pageSub}>Vinyl Hall · {availableCount} table{availableCount !== 1 ? "s" : ""} available</Text>
              </View>
              <View style={styles.locationBadge}>
                <Ionicons name="disc" size={13} color="#a855f7" />
                <Text style={styles.locationBadgeText}>Vinyl Hall</Text>
              </View>
            </View>

            {/* My stats */}
            {myStats.total > 0 && (
              <View style={styles.statsRow}>
                <StatPill label="Wins" value={myStats.wins} color="#22c55e" />
                <StatPill label="Losses" value={myStats.losses} color="#ef4444" />
                <StatPill label="Played" value={myStats.total} color="#888" />
              </View>
            )}

            {/* Tables grid */}
            <SectionLabel text="Pool Tables" />
            {tables.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No tables set up yet.</Text>
                <Text style={styles.emptySub}>Ask staff to add tables in Supabase.</Text>
              </View>
            ) : (
              <View style={styles.tablesGrid}>
                {tables.map((table) => {
                  const available = table.status === "available";
                  return (
                    <View
                      key={table.id}
                      style={[styles.tableCard, !available && styles.tableCardOccupied]}
                    >
                      <View style={styles.tableTop}>
                        <View style={[styles.tableNum, !available && styles.tableNumOccupied]}>
                          <Text style={[styles.tableNumText, !available && styles.tableNumTextOccupied]}>
                            {table.table_number}
                          </Text>
                        </View>
                        <View style={[styles.statusDot, available ? styles.dotAvailable : styles.dotOccupied]} />
                      </View>
                      {table.name && <Text style={styles.tableName}>{table.name}</Text>}
                      <Text style={[styles.tableStatus, !available && styles.tableStatusOccupied]}>
                        {available ? "Available" : "In Use"}
                      </Text>
                      {!available && table.players.length > 0 && (
                        <Text style={styles.tablePlayers} numberOfLines={1}>{table.players.join(" vs ")}</Text>
                      )}
                      {available ? (
                        <Pressable style={styles.claimBtn} onPress={() => { setSelectedTable(table); setStartModal(true); }}>
                          <Text style={styles.claimBtnText}>Claim</Text>
                        </Pressable>
                      ) : (
                        <Pressable style={styles.endBtn} onPress={() => { setEndModal(table); setWinnerId(null); }}>
                          <Text style={styles.endBtnText}>End Game</Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Recent games */}
            {recentGames.length > 0 && (
              <>
                <SectionLabel text="Recent Games" />
                {recentGames.map((g) => (
                  <View key={g.id} style={styles.recentCard}>
                    <View style={styles.recentLeft}>
                      <View style={styles.recentGameTypeBadge}>
                        <Text style={styles.recentGameTypeText}>{g.game_type}</Text>
                      </View>
                      <View>
                        <Text style={styles.recentPlayers}>{g.player_names.join(" vs ")}</Text>
                        <Text style={styles.recentMeta}>Table {g.table_number} · {relTime(g.created_at)}</Text>
                      </View>
                    </View>
                    {g.winner_name && (
                      <View style={styles.winnerTag}>
                        <Ionicons name="trophy" size={11} color="#f59e0b" />
                        <Text style={styles.winnerText}>{g.winner_name}</Text>
                      </View>
                    )}
                  </View>
                ))}
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
      <BottomTabBar />

      {/* Start game modal */}
      <Modal visible={startModal} transparent animationType="slide" onRequestClose={() => setStartModal(false)}>
        <View style={styles.modalBg}>
          <Pressable style={styles.modalDismiss} onPress={() => setStartModal(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Start Game</Text>
            {selectedTable && (
              <Text style={styles.modalSub}>Table {selectedTable.table_number}</Text>
            )}

            {/* Game type picker */}
            <Text style={styles.fieldLabel}>Game Type</Text>
            <View style={styles.gameTypeGrid}>
              {GAME_TYPES.map((gt) => {
                const active = gameType === gt.key;
                return (
                  <Pressable
                    key={gt.key}
                    style={[styles.gameTypeCard, active && styles.gameTypeCardActive]}
                    onPress={() => setGameType(gt.key)}
                  >
                    <Text style={[styles.gameTypeLabel, active && styles.gameTypeLabelActive]}>{gt.label}</Text>
                    <Text style={styles.gameTypeDesc}>{gt.players}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Opponent search */}
            <Text style={styles.fieldLabel}>Add Opponents</Text>
            {opponents.length > 0 && (
              <View style={styles.opponentChips}>
                {opponents.map((o) => (
                  <Pressable key={o.id} style={styles.opponentChip} onPress={() => setOpponents(prev => prev.filter(p => p.id !== o.id))}>
                    <Text style={styles.opponentChipText}>{o.username}</Text>
                    <Ionicons name="close-circle" size={14} color="#555" />
                  </Pressable>
                ))}
              </View>
            )}
            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={16} color="#444" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search username…"
                placeholderTextColor="#333"
                autoCapitalize="none"
                value={opponentSearch}
                onChangeText={(t) => { setOpponentSearch(t); searchOpponents(t); }}
              />
              {searching && <ActivityIndicator size="small" color="#a855f7" />}
            </View>
            <ScrollView style={{ maxHeight: 160 }} keyboardShouldPersistTaps="handled">
              {opponentResults.map((u) => (
                <Pressable key={u.id} style={styles.resultRow} onPress={() => { setOpponents(prev => [...prev, u]); setOpponentSearch(""); setOpponentResults([]); }}>
                  <Avatar uri={u.avatar_url} name={u.username} size={36} />
                  <Text style={styles.resultName}>{u.username}</Text>
                  <Ionicons name="add-circle-outline" size={20} color="#a855f7" />
                </Pressable>
              ))}
            </ScrollView>

            {startError && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
                <Text style={styles.errorText}>{startError}</Text>
              </View>
            )}

            <View style={styles.modalBtns}>
              <Pressable style={styles.modalCancel} onPress={() => setStartModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalConfirm, starting && { opacity: 0.5 }]} onPress={handleStartGame} disabled={starting}>
                <Text style={styles.modalConfirmText}>{starting ? "Starting…" : "Start Game"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* End game / record winner modal */}
      <Modal visible={!!endModal} transparent animationType="slide" onRequestClose={() => setEndModal(null)}>
        <View style={styles.modalBg}>
          <Pressable style={styles.modalDismiss} onPress={() => setEndModal(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>End Game</Text>
            <Text style={styles.modalSub}>Who won?</Text>

            {endModal && endModal.players.length > 0 && (
              <View style={styles.winnerList}>
                {[...endModal.players].map((name, i) => (
                  <Pressable key={i} style={[styles.winnerRow, winnerId === name && styles.winnerRowSelected]} onPress={() => setWinnerId(name)}>
                    <View style={[styles.winnerRadio, winnerId === name && styles.winnerRadioActive]}>
                      {winnerId === name && <View style={styles.winnerRadioDot} />}
                    </View>
                    <Text style={[styles.winnerName, winnerId === name && styles.winnerNameSelected]}>{name}</Text>
                    {winnerId === name && <Ionicons name="trophy" size={16} color="#f59e0b" />}
                  </Pressable>
                ))}
              </View>
            )}

            <View style={styles.modalBtns}>
              <Pressable style={styles.modalCancel} onPress={() => setEndModal(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirm, (!winnerId || ending) && styles.modalConfirmOff]}
                onPress={() => endModal && handleEndGame(endModal)}
                disabled={!winnerId || ending}
              >
                <Text style={styles.modalConfirmText}>{ending ? "Saving…" : "Record Result"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.statPill, { borderColor: color + "30", backgroundColor: color + "10" }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  safe: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },

  pageHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 24 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  pageTitle: { color: "#fff", fontSize: 26, fontWeight: "900", letterSpacing: -0.4 },
  pageSub: { color: "#555", fontSize: 13 },
  locationBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(168,85,247,0.12)", borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: "rgba(168,85,247,0.25)",
  },
  locationBadgeText: { color: "#a855f7", fontSize: 12, fontWeight: "800" },

  statsRow: { flexDirection: "row", gap: 10, marginBottom: 24 },
  statPill: { flex: 1, borderRadius: 14, padding: 14, alignItems: "center", borderWidth: 1 },
  statValue: { fontSize: 22, fontWeight: "900" },
  statLabel: { color: "#555", fontSize: 11, fontWeight: "700", textTransform: "uppercase", marginTop: 2 },

  sectionLabel: { color: "#444", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 14 },

  tablesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 32 },
  tableCard: {
    width: "47%", backgroundColor: "#111",
    borderRadius: 20, padding: 16,
    borderWidth: 1, borderColor: "#1e1e1e",
    gap: 6,
  },
  tableCardOccupied: { borderColor: "rgba(239,68,68,0.2)", backgroundColor: "#110808" },
  tableTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tableNum: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: "rgba(168,85,247,0.12)",
    borderWidth: 1, borderColor: "rgba(168,85,247,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  tableNumOccupied: { backgroundColor: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.2)" },
  tableNumText: { color: "#a855f7", fontWeight: "900", fontSize: 16 },
  tableNumTextOccupied: { color: "#ef4444" },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotAvailable: { backgroundColor: "#22c55e" },
  dotOccupied: { backgroundColor: "#ef4444" },
  tableName: { color: "#888", fontSize: 12, fontWeight: "600" },
  tableStatus: { color: "#22c55e", fontSize: 12, fontWeight: "800" },
  tableStatusOccupied: { color: "#ef4444" },
  tablePlayers: { color: "#444", fontSize: 11, numberOfLines: 1 } as any,
  claimBtn: {
    backgroundColor: "#a855f7", borderRadius: 10,
    paddingVertical: 9, alignItems: "center", marginTop: 4,
  },
  claimBtnText: { color: "#fff", fontWeight: "900", fontSize: 13 },
  endBtn: {
    backgroundColor: "rgba(239,68,68,0.12)", borderRadius: 10,
    paddingVertical: 9, alignItems: "center", marginTop: 4,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.25)",
  },
  endBtnText: { color: "#ef4444", fontWeight: "800", fontSize: 13 },

  emptyCard: { backgroundColor: "#0d0d0d", borderRadius: 18, padding: 28, alignItems: "center", borderWidth: 1, borderColor: "#1a1a1a" },
  emptyText: { color: "#fff", fontSize: 16, fontWeight: "800", marginBottom: 4 },
  emptySub: { color: "#444", fontSize: 13 },

  recentCard: {
    backgroundColor: "#111", borderRadius: 16, padding: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 8, borderWidth: 1, borderColor: "#1e1e1e",
  },
  recentLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  recentGameTypeBadge: { backgroundColor: "rgba(168,85,247,0.12)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  recentGameTypeText: { color: "#a855f7", fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  recentPlayers: { color: "#fff", fontSize: 14, fontWeight: "700" },
  recentMeta: { color: "#444", fontSize: 12, marginTop: 1 },
  winnerTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  winnerText: { color: "#f59e0b", fontSize: 12, fontWeight: "800" },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "flex-end" },
  modalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  modalSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 36,
    borderTopWidth: 1, borderColor: "#1e1e1e",
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 20 },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 2 },
  modalSub: { color: "#555", fontSize: 14, marginBottom: 20 },
  fieldLabel: { color: "#444", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },

  gameTypeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  gameTypeCard: { width: "47%", backgroundColor: "#0d0d0d", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#1e1e1e" },
  gameTypeCardActive: { borderColor: "rgba(168,85,247,0.5)", backgroundColor: "rgba(168,85,247,0.1)" },
  gameTypeLabel: { color: "#888", fontWeight: "800", fontSize: 14, marginBottom: 2 },
  gameTypeLabelActive: { color: "#a855f7" },
  gameTypeDesc: { color: "#333", fontSize: 11 },

  opponentChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  opponentChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(168,85,247,0.12)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "rgba(168,85,247,0.25)" },
  opponentChipText: { color: "#a855f7", fontSize: 13, fontWeight: "700" },

  searchWrap: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#0a0a0a", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 6 },
  searchInput: { flex: 1, color: "#fff", fontSize: 15 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  resultName: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700" },

  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },

  modalBtns: { flexDirection: "row", gap: 10, marginTop: 16 },
  modalCancel: { flex: 1, backgroundColor: "#1a1a1a", borderRadius: 14, padding: 15, alignItems: "center" },
  modalCancelText: { color: "#888", fontWeight: "700" },
  modalConfirm: { flex: 1, backgroundColor: "#a855f7", borderRadius: 14, padding: 15, alignItems: "center" },
  modalConfirmOff: { backgroundColor: "#1a1a1a" },
  modalConfirmText: { color: "#fff", fontWeight: "900" },

  winnerList: { gap: 8, marginBottom: 8 },
  winnerRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#0d0d0d", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#1e1e1e" },
  winnerRowSelected: { borderColor: "rgba(245,158,11,0.4)", backgroundColor: "rgba(245,158,11,0.06)" },
  winnerRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#2a2a2a", alignItems: "center", justifyContent: "center" },
  winnerRadioActive: { borderColor: "#f59e0b" },
  winnerRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#f59e0b" },
  winnerName: { flex: 1, color: "#888", fontSize: 15, fontWeight: "700" },
  winnerNameSelected: { color: "#fff" },
});
