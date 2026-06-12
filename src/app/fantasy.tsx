import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import Head from "expo-router/head";
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
import { supabase } from "../../lib/supabase";
import { showToast } from "../components/toast";
import { useRequireAuth } from "../hooks/use-require-auth";

type Line = { line: number; over: number; under: number };
type BoardTeam = {
  team_id: string; team_name: string; weeks_played: number;
  avg_weekly: number; last_week_pts: number | null; hot: boolean; lines: Line[];
};
type MyPick = {
  id: string; team_id: string; team_name: string; line: number;
  pick: "over" | "under"; stake: number; multiplier: number; status: string;
};
type HistoryRow = {
  week_of: string; team_name: string; line: number; pick: string; stake: number;
  multiplier: number; status: string; result_points: number | null; payout: number;
};
type Leader = { username: string; avatar_url: string | null; lifetime_earned: number; is_me: boolean };
type MarketPlayer = {
  player_user_id: string; username: string; avatar_url: string | null;
  games: number; avg_score: number; price: number; hot: boolean; tournament_podiums: number;
};

type FantasyState = {
  week_of: string; locked: boolean; balance: number; lifetime_earned: number;
  stipend_granted: boolean; full_mode: boolean; seasons_done: number; seasons_required: number;
  board: BoardTeam[]; my_picks: MyPick[]; history: HistoryRow[];
  last_week_results: { team_name: string; points: number }[]; leaderboard: Leader[];
};

const STAKES = [5, 10, 25, 50];

function Coin({ size = 13 }: { size?: number }) {
  return <Ionicons name="server-outline" size={size} color="#f59e0b" />;
}

export default function FantasyScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [state, setState] = useState<FantasyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"board" | "market">("board");

  // Market
  const [market, setMarket] = useState<MarketPlayer[] | null>(null);
  const [marketFullMode, setMarketFullMode] = useState(false);
  const [marketLoading, setMarketLoading] = useState(false);

  // Stake sheet
  const [pickTarget, setPickTarget] = useState<{ team: BoardTeam; line: number; pick: "over" | "under"; mult: number } | null>(null);
  const [stake, setStake] = useState(10);
  const [placing, setPlacing] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase.rpc("rpc_fantasy_get_state");
    setLoading(false);
    setRefreshing(false);
    if (error || data?.error) {
      showToast(data?.message ?? "Couldn't load Fantasy. Pull to retry.", "error");
      return;
    }
    setState(data as FantasyState);
    if ((data as FantasyState).stipend_granted) {
      showToast("+20 coins — weekly stipend collected 🪙");
    }
  }

  async function loadMarket() {
    if (market || marketLoading) return;
    setMarketLoading(true);
    const { data } = await supabase.rpc("rpc_fantasy_market");
    setMarketLoading(false);
    if (data && !data.error) {
      setMarket(data.players ?? []);
      setMarketFullMode(!!data.full_mode);
    }
  }

  useEffect(() => { if (user) load(); }, [user]);
  useEffect(() => { if (tab === "market") loadMarket(); }, [tab]);

  async function placePick() {
    if (!pickTarget || placing) return;
    setPlacing(true);
    const { data, error } = await supabase.rpc("rpc_fantasy_place_prediction", {
      p_team_id: pickTarget.team.team_id,
      p_line: pickTarget.line,
      p_pick: pickTarget.pick,
      p_stake: stake,
    });
    setPlacing(false);
    if (error || data?.error) {
      showToast(data?.message ?? "Couldn't place that pick.", "error");
      return;
    }
    showToast(`Pick locked at ×${data.multiplier} — win pays ${data.potential_payout} 🪙`);
    setPickTarget(null);
    load();
  }

  async function cancelPick(id: string) {
    setCancelling(id);
    const { data, error } = await supabase.rpc("rpc_fantasy_cancel_prediction", { p_id: id });
    setCancelling(null);
    if (error || data?.error) {
      showToast(data?.message ?? "Couldn't cancel.", "error");
      return;
    }
    showToast("Pick cancelled — stake refunded");
    load();
  }

  if (authLoading || loading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#a855f7" /></View>;
  }
  if (!state) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.loader}>
          <Text style={{ color: "#888" }}>Couldn't load Fantasy.</Text>
          <Pressable style={s.retryBtn} onPress={() => { setLoading(true); load(); }}>
            <Text style={s.retryText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const seasonsPct = Math.min(state.seasons_done / state.seasons_required, 1);

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Head><title>Fantasy Skee-Ball · ArcadeTracker</title></Head>

      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/leagues" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>Fantasy Skee-Ball</Text>
        <View style={s.coinPill}>
          <Coin size={14} />
          <Text style={s.coinPillText}>{state.balance}</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={s.tabRow}>
        <Pressable style={[s.tabBtn, tab === "board" && s.tabBtnActive]} onPress={() => setTab("board")}>
          <Text style={[s.tabText, tab === "board" && s.tabTextActive]}>The Board</Text>
        </Pressable>
        <Pressable style={[s.tabBtn, tab === "market" && s.tabBtnActive]} onPress={() => setTab("market")}>
          <Text style={[s.tabText, tab === "market" && s.tabTextActive]}>Transfer Market</Text>
          {!state.full_mode && <Ionicons name="lock-closed" size={11} color="#666" style={{ marginLeft: 4 }} />}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); setMarket(null); }} tintColor="#a855f7" />}
      >
        {tab === "board" ? (
          <>
            {/* Phase roadmap */}
            {!state.full_mode && (
              <View style={s.phaseCard}>
                <View style={s.phaseHeader}>
                  <Ionicons name="rocket-outline" size={15} color="#a855f7" />
                  <Text style={s.phaseTitle}>Full fantasy unlocks after {state.seasons_required} full seasons</Text>
                </View>
                <View style={s.phaseBarTrack}>
                  <View style={[s.phaseBarFill, { width: `${Math.max(seasonsPct * 100, 4)}%` }]} />
                </View>
                <Text style={s.phaseSub}>
                  {state.seasons_done} of {state.seasons_required} counted seasons complete. Player prices, salary-cap rosters
                  and the transfer market go live once the league has enough history — until then, build your bankroll on the board.
                </Text>
              </View>
            )}

            {/* Lock banner */}
            {state.locked && (
              <View style={s.lockBanner}>
                <Ionicons name="lock-closed" size={13} color="#f59e0b" />
                <Text style={s.lockText}>The board is locked — this week's games are underway. New lines open after settlement.</Text>
              </View>
            )}

            {/* My picks */}
            {state.my_picks.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>MY PICKS THIS WEEK</Text>
                {state.my_picks.map((p) => (
                  <View key={p.id} style={s.myPickRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.myPickTeam}>{p.team_name}</Text>
                      <Text style={s.myPickDetail}>
                        {p.pick === "over" ? "Over" : "Under"} {p.line} pts · {p.stake} 🪙 at ×{Number(p.multiplier).toFixed(2)}
                      </Text>
                    </View>
                    <Text style={s.myPickPayout}>wins {Math.round(p.stake * p.multiplier)} 🪙</Text>
                    {!state.locked && (
                      <Pressable hitSlop={8} onPress={() => cancelPick(p.id)} disabled={cancelling === p.id}>
                        {cancelling === p.id
                          ? <ActivityIndicator size="small" color="#888" />
                          : <Ionicons name="close-circle" size={20} color="#555" />}
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* The board */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>THIS WEEK'S BOARD</Text>
              <Text style={s.sectionSub}>
                Will a team's total league points this Monday land over or under the line? Odds come from their real history — streaky teams pay big.
              </Text>
              {state.board.length === 0 && (
                <Text style={s.emptyText}>No teams with league history yet — the board opens once games are played.</Text>
              )}
              {state.board.map((t) => (
                <View key={t.team_id} style={s.teamCard}>
                  <View style={s.teamHeader}>
                    <Text style={s.teamName} numberOfLines={1}>{t.team_name}</Text>
                    {t.hot && <Text style={s.hotBadge}>🔥 HOT</Text>}
                    <Text style={s.teamMeta}>avg {t.avg_weekly}/wk</Text>
                  </View>
                  {t.lines.map((l) => (
                    <View key={l.line} style={s.lineRow}>
                      <Text style={s.lineLabel}>{l.line} pts</Text>
                      <Pressable
                        style={[s.oddsBtn, state.locked && s.oddsBtnDisabled]}
                        disabled={state.locked}
                        onPress={() => { setStake(10); setPickTarget({ team: t, line: l.line, pick: "over", mult: l.over }); }}
                      >
                        <Text style={s.oddsBtnLabel}>Over</Text>
                        <Text style={s.oddsBtnMult}>×{Number(l.over).toFixed(2)}</Text>
                      </Pressable>
                      <Pressable
                        style={[s.oddsBtn, state.locked && s.oddsBtnDisabled]}
                        disabled={state.locked}
                        onPress={() => { setStake(10); setPickTarget({ team: t, line: l.line, pick: "under", mult: l.under }); }}
                      >
                        <Text style={s.oddsBtnLabel}>Under</Text>
                        <Text style={s.oddsBtnMult}>×{Number(l.under).toFixed(2)}</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ))}
            </View>

            {/* Last week results */}
            {state.last_week_results.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>LAST WEEK'S TOTALS</Text>
                {state.last_week_results.map((r) => (
                  <View key={r.team_name} style={s.resultRow}>
                    <Text style={s.resultTeam} numberOfLines={1}>{r.team_name}</Text>
                    <Text style={s.resultPts}>{r.points} pts</Text>
                  </View>
                ))}
              </View>
            )}

            {/* History */}
            {state.history.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>MY RESULTS</Text>
                {state.history.map((h, i) => (
                  <View key={i} style={s.historyRow}>
                    <Ionicons
                      name={h.status === "won" ? "checkmark-circle" : h.status === "void" ? "remove-circle" : "close-circle"}
                      size={16}
                      color={h.status === "won" ? "#22c55e" : h.status === "void" ? "#888" : "#ef4444"}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={s.historyTeam}>{h.team_name} — {h.pick} {h.line}</Text>
                      <Text style={s.historyDetail}>
                        {h.result_points !== null ? `scored ${h.result_points}` : "didn't play"} · staked {h.stake}
                      </Text>
                    </View>
                    <Text style={[s.historyPayout, { color: h.status === "won" ? "#22c55e" : "#666" }]}>
                      {h.status === "won" ? `+${h.payout}` : h.status === "void" ? "refund" : `-${h.stake}`}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Leaderboard */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>TOP PREDICTORS</Text>
              <Text style={s.sectionSub}>Ranked by lifetime coins won. Weekly top winner gets a +25 bonus.</Text>
              {state.leaderboard.length === 0 && (
                <Text style={s.emptyText}>Nobody's cashed a pick yet — be the first on the board.</Text>
              )}
              {state.leaderboard.map((l, i) => (
                <View key={`${l.username}-${i}`} style={[s.leaderRow, l.is_me && s.leaderRowMe]}>
                  <Text style={[s.leaderRank, i < 3 && { color: "#f59e0b" }]}>{i + 1}</Text>
                  {l.avatar_url
                    ? <Image source={{ uri: l.avatar_url }} style={s.leaderAvatar} contentFit="cover" />
                    : <View style={[s.leaderAvatar, s.leaderAvatarFallback]}><Text style={s.leaderAvatarText}>{l.username[0]?.toUpperCase()}</Text></View>}
                  <Text style={s.leaderName} numberOfLines={1}>{l.username}{l.is_me ? " (you)" : ""}</Text>
                  <Coin size={12} />
                  <Text style={s.leaderCoins}>{l.lifetime_earned}</Text>
                </View>
              ))}
            </View>
          </>
        ) : (
          <>
            {/* Market */}
            {!marketFullMode && (
              <View style={s.phaseCard}>
                <View style={s.phaseHeader}>
                  <Ionicons name="lock-closed" size={14} color="#a855f7" />
                  <Text style={s.phaseTitle}>Transfer market preview</Text>
                </View>
                <Text style={s.phaseSub}>
                  Player prices below are provisional — they're computed live from per-game scoring averages
                  (league nights and solo tournaments both count). Buying, selling and salary-cap rosters
                  unlock after {state.seasons_required} full seasons of data.
                </Text>
              </View>
            )}
            {marketLoading && <ActivityIndicator color="#a855f7" style={{ marginTop: 30 }} />}
            {market && market.length === 0 && (
              <Text style={s.emptyText}>No players with 3+ skee-ball games yet — play league nights to enter the market.</Text>
            )}
            {(market ?? []).map((p) => (
              <View key={p.player_user_id} style={s.playerCard}>
                {p.avatar_url
                  ? <Image source={{ uri: p.avatar_url }} style={s.playerAvatar} contentFit="cover" />
                  : <View style={[s.playerAvatar, s.leaderAvatarFallback]}><Text style={s.leaderAvatarText}>{p.username[0]?.toUpperCase()}</Text></View>}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={s.playerName} numberOfLines={1}>{p.username}</Text>
                    {p.hot && <Text style={s.hotBadge}>🔥</Text>}
                  </View>
                  <Text style={s.playerMeta}>
                    {p.avg_score} avg · {p.games} games{p.tournament_podiums > 0 ? ` · ${p.tournament_podiums}× podium` : ""}
                  </Text>
                </View>
                <View style={s.priceTag}>
                  <Coin size={11} />
                  <Text style={s.priceText}>{p.price}</Text>
                </View>
              </View>
            ))}
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Stake sheet */}
      <Modal visible={!!pickTarget} transparent animationType="slide" onRequestClose={() => setPickTarget(null)}>
        <View style={s.modalBg}>
          <Pressable style={s.modalDismiss} onPress={() => setPickTarget(null)} />
          {pickTarget && (
            <View style={s.sheet}>
              <View style={s.sheetHandle} />
              <Text style={s.sheetTitle}>{pickTarget.team.team_name}</Text>
              <Text style={s.sheetSub}>
                {pickTarget.pick === "over" ? "OVER" : "UNDER"} {pickTarget.line} league points this week · odds ×{Number(pickTarget.mult).toFixed(2)}
              </Text>
              <View style={s.stakeRow}>
                {STAKES.map((v) => (
                  <Pressable
                    key={v}
                    style={[s.stakeChip, stake === v && s.stakeChipActive, v > state.balance && s.stakeChipDisabled]}
                    disabled={v > state.balance}
                    onPress={() => setStake(v)}
                  >
                    <Text style={[s.stakeChipText, stake === v && { color: "#000" }]}>{v} 🪙</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={s.payoutPreview}>
                Win pays <Text style={{ color: "#22c55e", fontWeight: "900" }}>{Math.round(stake * pickTarget.mult)} coins</Text>
              </Text>
              <Pressable
                style={[s.confirmBtn, (placing || stake > state.balance) && { opacity: 0.5 }]}
                disabled={placing || stake > state.balance}
                onPress={placePick}
              >
                {placing
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Text style={s.confirmText}>Lock it in</Text>}
              </Pressable>
              {stake > state.balance && (
                <Text style={s.insufficientText}>Not enough coins — your +20 stipend lands every Monday.</Text>
              )}
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", gap: 14 },
  retryBtn: { backgroundColor: "#1a1a1a", borderRadius: 12, paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { color: "#fff", fontWeight: "700" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, color: "#fff", fontSize: 18, fontWeight: "900" },
  coinPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(245,158,11,0.1)", borderWidth: 1, borderColor: "rgba(245,158,11,0.3)",
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
  },
  coinPillText: { color: "#f59e0b", fontSize: 14, fontWeight: "900" },

  tabRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 6 },
  tabBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#0d0d0d", borderRadius: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  tabBtnActive: { backgroundColor: "rgba(168,85,247,0.12)", borderColor: "rgba(168,85,247,0.4)" },
  tabText: { color: "#777", fontSize: 13.5, fontWeight: "800" },
  tabTextActive: { color: "#d8b4fe" },

  content: { paddingHorizontal: 16, paddingTop: 8 },

  phaseCard: {
    backgroundColor: "rgba(168,85,247,0.05)", borderRadius: 16, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: "rgba(168,85,247,0.22)",
  },
  phaseHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 8 },
  phaseTitle: { color: "#d8b4fe", fontSize: 13.5, fontWeight: "800", flex: 1 },
  phaseBarTrack: { height: 6, borderRadius: 3, backgroundColor: "#1a1a1a", marginBottom: 8 },
  phaseBarFill: { height: 6, borderRadius: 3, backgroundColor: "#a855f7" },
  phaseSub: { color: "#999", fontSize: 12.5, lineHeight: 18 },

  lockBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(245,158,11,0.07)", borderRadius: 12, padding: 11, marginBottom: 12,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.22)",
  },
  lockText: { flex: 1, color: "#fbbf24", fontSize: 12.5, lineHeight: 17 },

  section: { marginBottom: 18 },
  sectionTitle: { color: "#666", fontSize: 11, fontWeight: "800", letterSpacing: 1, marginBottom: 6 },
  sectionSub: { color: "#888", fontSize: 12.5, lineHeight: 18, marginBottom: 10 },
  emptyText: { color: "#666", fontSize: 13, paddingVertical: 14, textAlign: "center" },

  myPickRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#0d0d0d", borderRadius: 14, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: "rgba(168,85,247,0.25)",
  },
  myPickTeam: { color: "#fff", fontSize: 14, fontWeight: "800" },
  myPickDetail: { color: "#999", fontSize: 12, marginTop: 2 },
  myPickPayout: { color: "#22c55e", fontSize: 12.5, fontWeight: "800" },

  teamCard: {
    backgroundColor: "#0d0d0d", borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  teamHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  teamName: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "900" },
  hotBadge: { color: "#f59e0b", fontSize: 11, fontWeight: "900" },
  teamMeta: { color: "#777", fontSize: 12, fontWeight: "700" },
  lineRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  lineLabel: { width: 52, color: "#aaa", fontSize: 13, fontWeight: "800" },
  oddsBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#141414", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: "#222",
  },
  oddsBtnDisabled: { opacity: 0.4 },
  oddsBtnLabel: { color: "#ccc", fontSize: 12.5, fontWeight: "700" },
  oddsBtnMult: { color: "#a855f7", fontSize: 13, fontWeight: "900" },

  resultRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#161616",
  },
  resultTeam: { flex: 1, color: "#ccc", fontSize: 13.5, fontWeight: "600" },
  resultPts: { color: "#06b6d4", fontSize: 13.5, fontWeight: "900" },

  historyRow: {
    flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#161616",
  },
  historyTeam: { color: "#ddd", fontSize: 13, fontWeight: "700" },
  historyDetail: { color: "#777", fontSize: 11.5, marginTop: 1 },
  historyPayout: { fontSize: 13, fontWeight: "900" },

  leaderRow: {
    flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 8,
    borderRadius: 12,
  },
  leaderRowMe: { backgroundColor: "rgba(168,85,247,0.08)" },
  leaderRank: { width: 22, color: "#888", fontSize: 13, fontWeight: "900" },
  leaderAvatar: { width: 30, height: 30, borderRadius: 15 },
  leaderAvatarFallback: { backgroundColor: "#222", alignItems: "center", justifyContent: "center" },
  leaderAvatarText: { color: "#aaa", fontSize: 13, fontWeight: "900" },
  leaderName: { flex: 1, color: "#fff", fontSize: 13.5, fontWeight: "700" },
  leaderCoins: { color: "#f59e0b", fontSize: 13.5, fontWeight: "900" },

  playerCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#0d0d0d", borderRadius: 16, padding: 13, marginBottom: 8,
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  playerAvatar: { width: 40, height: 40, borderRadius: 20 },
  playerName: { color: "#fff", fontSize: 14.5, fontWeight: "800" },
  playerMeta: { color: "#888", fontSize: 12, marginTop: 2 },
  priceTag: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(245,158,11,0.1)", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.25)",
  },
  priceText: { color: "#f59e0b", fontSize: 13.5, fontWeight: "900" },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "flex-end" },
  modalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 14, paddingBottom: 36,
    borderTopWidth: 1, borderColor: "#1e1e1e",
    width: "100%", maxWidth: 560, alignSelf: "center",
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 14 },
  sheetTitle: { color: "#fff", fontSize: 19, fontWeight: "900", textAlign: "center" },
  sheetSub: { color: "#999", fontSize: 13.5, textAlign: "center", marginTop: 6, marginBottom: 18 },
  stakeRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  stakeChip: {
    flex: 1, alignItems: "center", backgroundColor: "#0a0a0a", borderRadius: 12,
    paddingVertical: 12, borderWidth: 1, borderColor: "#222",
  },
  stakeChipActive: { backgroundColor: "#a855f7", borderColor: "#a855f7" },
  stakeChipDisabled: { opacity: 0.35 },
  stakeChipText: { color: "#ccc", fontSize: 13.5, fontWeight: "800" },
  payoutPreview: { color: "#999", fontSize: 13.5, textAlign: "center", marginBottom: 14 },
  confirmBtn: {
    backgroundColor: "#a855f7", borderRadius: 14, paddingVertical: 15, alignItems: "center",
  },
  confirmText: { color: "#000", fontSize: 15, fontWeight: "900" },
  insufficientText: { color: "#f59e0b", fontSize: 12, textAlign: "center", marginTop: 10 },
});
