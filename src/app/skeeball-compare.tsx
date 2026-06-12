import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/avatar";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";
import { RingBreakdown, TrendBadge, WeeklyBarChart } from "../components/skeeball-stats";
import {
  fetchPlayerStats,
  fetchSkeeSeasons,
  type PlayerStats,
  type SkeeSeason,
} from "../lib/skeeball-stats";

type PickedUser = { id: string; username: string; avatar_url: string | null };

const COLOR_A = "#06b6d4";
const COLOR_B = "#a855f7";

export default function SkeeballCompareScreen() {
  const { teamId } = useLocalSearchParams<{ teamId?: string }>();
  const { user, loading: authLoading } = useRequireAuth();

  const [seasons, setSeasons] = useState<SkeeSeason[]>([]);
  const [scopeId, setScopeId] = useState<string | "all">("all");

  const [playerA, setPlayerA] = useState<PickedUser | null>(null);
  const [playerB, setPlayerB] = useState<PickedUser | null>(null);
  const [statsA, setStatsA] = useState<PlayerStats | null>(null);
  const [statsB, setStatsB] = useState<PlayerStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Picker modal
  const [pickerFor, setPickerFor] = useState<"a" | "b" | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PickedUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [teamMembers, setTeamMembers] = useState<PickedUser[]>([]);

  useEffect(() => {
    if (!user) return;
    fetchSkeeSeasons().then((all) => {
      setSeasons(all);
      const active = all.find((s) => s.status === "active");
      if (active) setScopeId(active.id);
    });
    // Suggest teammates first when opened from a team page
    if (teamId) {
      supabase
        .from("team_members")
        .select("user_id, profiles(username, avatar_url)")
        .eq("team_id", teamId)
        .then(({ data }) => {
          setTeamMembers((data ?? []).map((m: any) => {
            const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
            return { id: m.user_id, username: p?.username ?? "Unknown", avatar_url: p?.avatar_url ?? null };
          }));
        });
    }
  }, [user, teamId]);

  const scope = seasons.find((s) => s.id === scopeId) ?? null;

  useEffect(() => {
    if (!playerA && !playerB) return;
    setLoadingStats(true);
    Promise.all([
      playerA ? fetchPlayerStats(playerA.id, scope) : Promise.resolve(null),
      playerB ? fetchPlayerStats(playerB.id, scope) : Promise.resolve(null),
    ]).then(([a, b]) => {
      setStatsA(a);
      setStatsB(b);
      setLoadingStats(false);
    });
  }, [playerA?.id, playerB?.id, scopeId, seasons.length]);

  async function searchUsers(q: string) {
    setSearch(q);
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("public_profiles")
      .select("id, username, avatar_url")
      .ilike("username", `%${q.replace(/\s+/g, "")}%`)
      .limit(12);
    setResults((data ?? []).map((p: any) => ({ id: p.id, username: p.username ?? "Unknown", avatar_url: p.avatar_url ?? null })));
    setSearching(false);
  }

  function pickUser(u: PickedUser) {
    if (pickerFor === "a") setPlayerA(u);
    else if (pickerFor === "b") setPlayerB(u);
    setPickerFor(null);
    setSearch("");
    setResults([]);
  }

  if (authLoading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  const bothPicked = playerA && playerB;
  const suggestions = teamMembers.filter((m) => m.id !== playerA?.id && m.id !== playerB?.id);

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/teams" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Compare Players</Text>
          <Text style={s.headerSub}>Skee-Ball League head-to-head</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        {/* Player slots */}
        <View style={s.slotsRow}>
          <PlayerSlot color={COLOR_A} player={playerA} onPress={() => setPickerFor("a")} />
          <View style={s.vsWrap}><Text style={s.vsText}>VS</Text></View>
          <PlayerSlot color={COLOR_B} player={playerB} onPress={() => setPickerFor("b")} />
        </View>

        {/* Season scope */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 18 }} contentContainerStyle={s.scopeRow}>
          <Pressable
            style={[s.scopeChip, scopeId === "all" && s.scopeChipActive]}
            onPress={() => setScopeId("all")}
          >
            <Text style={[s.scopeChipText, scopeId === "all" && s.scopeChipTextActive]}>All Seasons</Text>
          </Pressable>
          {seasons.map((sn) => (
            <Pressable
              key={sn.id}
              style={[s.scopeChip, scopeId === sn.id && s.scopeChipActive]}
              onPress={() => setScopeId(sn.id)}
            >
              {sn.status === "active" && <View style={s.liveDot} />}
              <Text style={[s.scopeChipText, scopeId === sn.id && s.scopeChipTextActive]}>{sn.name}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {!bothPicked ? (
          <View style={s.emptyCard}>
            <Ionicons name="git-compare-outline" size={36} color="#333" />
            <Text style={s.emptyTitle}>Pick two players</Text>
            <Text style={s.emptySub}>Select two league players above to compare averages, trends, and shot breakdowns.</Text>
          </View>
        ) : loadingStats ? (
          <ActivityIndicator color="#06b6d4" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Head-to-head numbers */}
            <View style={s.card}>
              <CompareRow label="Avg Score" a={statsA?.totals.avg} b={statsB?.totals.avg} higherWins />
              <CompareRow label="Best Game" a={statsA?.totals.best} b={statsB?.totals.best} higherWins />
              <CompareRow label="Games Played" a={statsA?.totals.games} b={statsB?.totals.games} />
              <CompareRow label="Balls Thrown" a={statsA?.totals.balls} b={statsB?.totals.balls} last />
            </View>

            {/* Trends */}
            <View style={s.trendRow}>
              <View style={s.trendCol}>
                <Text style={[s.trendName, { color: COLOR_A }]} numberOfLines={1}>{playerA!.username}</Text>
                {statsA && statsA.weeks.length >= 2 ? <TrendBadge weeks={statsA.weeks} /> : <Text style={s.trendNone}>Not enough weeks</Text>}
              </View>
              <View style={s.trendCol}>
                <Text style={[s.trendName, { color: COLOR_B }]} numberOfLines={1}>{playerB!.username}</Text>
                {statsB && statsB.weeks.length >= 2 ? <TrendBadge weeks={statsB.weeks} /> : <Text style={s.trendNone}>Not enough weeks</Text>}
              </View>
            </View>

            {/* Weekly overlay chart */}
            <Text style={s.sectionLabel}>Weekly Averages</Text>
            <View style={s.card}>
              <View style={s.legendRow}>
                <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: COLOR_A }]} /><Text style={s.legendText}>{playerA!.username}</Text></View>
                <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: COLOR_B }]} /><Text style={s.legendText}>{playerB!.username}</Text></View>
              </View>
              <WeeklyBarChart
                weeks={statsA?.weeks ?? []}
                compareWeeks={statsB?.weeks ?? []}
                season={scope}
                color={COLOR_A}
                compareColor={COLOR_B}
                height={130}
              />
            </View>

            {/* Shot breakdowns */}
            <Text style={s.sectionLabel}>Shot Breakdown</Text>
            <View style={s.breakdownRow}>
              <View style={[s.card, { flex: 1 }]}>
                <Text style={[s.breakdownName, { color: COLOR_A }]} numberOfLines={1}>{playerA!.username}</Text>
                <RingBreakdown rings={statsA?.totals.rings ?? {}} compact />
              </View>
              <View style={[s.card, { flex: 1 }]}>
                <Text style={[s.breakdownName, { color: COLOR_B }]} numberOfLines={1}>{playerB!.username}</Text>
                <RingBreakdown rings={statsB?.totals.rings ?? {}} compact />
              </View>
            </View>
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Player picker modal */}
      <Modal visible={pickerFor !== null} transparent animationType="slide" onRequestClose={() => setPickerFor(null)}>
        <View style={s.modalBg}>
          <Pressable style={s.modalDismiss} onPress={() => setPickerFor(null)} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>
              Select Player {pickerFor === "a" ? "1" : "2"}
            </Text>
            <View style={s.searchWrap}>
              <Ionicons name="search-outline" size={16} color="#444" />
              <TextInput
                style={s.searchInput}
                placeholder="Search by username…"
                placeholderTextColor="#555"
                autoFocus
                autoCapitalize="none"
                value={search}
                onChangeText={searchUsers}
              />
              {searching && <ActivityIndicator size="small" color="#555" />}
            </View>
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              {search.trim() === "" && suggestions.length > 0 && (
                <>
                  <Text style={s.suggestLabel}>Team Members</Text>
                  {suggestions.map((m) => (
                    <Pressable key={m.id} style={s.resultRow} onPress={() => pickUser(m)}>
                      <Avatar uri={m.avatar_url} name={m.username} size={38} />
                      <Text style={s.resultName}>{m.username}</Text>
                      <Ionicons name="add-circle-outline" size={20} color="#06b6d4" />
                    </Pressable>
                  ))}
                </>
              )}
              {results.map((r) => (
                <Pressable key={r.id} style={s.resultRow} onPress={() => pickUser(r)}>
                  <Avatar uri={r.avatar_url} name={r.username} size={38} />
                  <Text style={s.resultName}>{r.username}</Text>
                  <Ionicons name="add-circle-outline" size={20} color="#06b6d4" />
                </Pressable>
              ))}
              {search.trim() !== "" && results.length === 0 && !searching && (
                <Text style={s.noResults}>No users found</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function PlayerSlot({ player, color, onPress }: { player: PickedUser | null; color: string; onPress: () => void }) {
  return (
    <Pressable style={[s.slot, player && { borderColor: `${color}50` }]} onPress={onPress}>
      {player ? (
        <>
          <Avatar uri={player.avatar_url} name={player.username} size={46} />
          <Text style={[s.slotName, { color }]} numberOfLines={1}>{player.username}</Text>
          <Text style={s.slotChange}>Change</Text>
        </>
      ) : (
        <>
          <View style={s.slotAdd}>
            <Ionicons name="person-add-outline" size={20} color="#555" />
          </View>
          <Text style={s.slotPlaceholder}>Select player</Text>
        </>
      )}
    </Pressable>
  );
}

function CompareRow({ label, a, b, higherWins, last }: {
  label: string;
  a: number | null | undefined;
  b: number | null | undefined;
  higherWins?: boolean;
  last?: boolean;
}) {
  const av = a ?? 0;
  const bv = b ?? 0;
  const aWins = higherWins && av > bv;
  const bWins = higherWins && bv > av;
  return (
    <View style={[s.compareRow, !last && s.compareRowBorder]}>
      <Text style={[s.compareVal, { color: aWins ? COLOR_A : "#888" }, aWins && s.compareValWin]}>
        {a ?? "—"}
      </Text>
      <Text style={s.compareLabel}>{label}</Text>
      <Text style={[s.compareVal, { color: bWins ? COLOR_B : "#888", textAlign: "right" }, bWins && s.compareValWin]}>
        {b ?? "—"}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 18, paddingTop: 16 },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "#777", fontSize: 12, marginTop: 1 },

  slotsRow: { flexDirection: "row", alignItems: "stretch", gap: 10, marginBottom: 16 },
  slot: {
    flex: 1, alignItems: "center", gap: 6,
    backgroundColor: "#111", borderRadius: 18, padding: 16,
    borderWidth: 1.5, borderColor: "#1e1e1e",
  },
  slotName: { fontSize: 14, fontWeight: "800" },
  slotChange: { color: "#777", fontSize: 11, fontWeight: "600" },
  slotAdd: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#2a2a2a", borderStyle: "dashed",
  },
  slotPlaceholder: { color: "#8a8a8a", fontSize: 13, fontWeight: "600", marginTop: 4 },
  vsWrap: { justifyContent: "center" },
  vsText: { color: "#333", fontSize: 14, fontWeight: "900" },

  scopeRow: { gap: 8, alignItems: "center" },
  scopeChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#111", borderRadius: 18, paddingHorizontal: 13, paddingVertical: 7,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  scopeChipActive: { borderColor: "rgba(6,182,212,0.4)", backgroundColor: "rgba(6,182,212,0.08)" },
  scopeChipText: { color: "#8a8a8a", fontSize: 12.5, fontWeight: "600" },
  scopeChipTextActive: { color: "#06b6d4", fontWeight: "800" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e" },

  emptyCard: {
    backgroundColor: "#0d0d0d", borderRadius: 20, padding: 36, alignItems: "center", gap: 10,
    borderWidth: 1, borderColor: "#1a1a1a", marginTop: 12,
  },
  emptyTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  emptySub: { color: "#8a8a8a", fontSize: 13, textAlign: "center", lineHeight: 19 },

  sectionLabel: {
    color: "#6b6b6b", fontSize: 10, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10, marginTop: 6,
  },

  card: {
    backgroundColor: "#111", borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 14, gap: 8,
  },

  compareRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  compareRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  compareVal: { flex: 1, fontSize: 17, fontWeight: "900" },
  compareValWin: { fontSize: 19 },
  compareLabel: { flex: 1.4, color: "#777", fontSize: 11.5, fontWeight: "700", textAlign: "center", textTransform: "uppercase", letterSpacing: 0.6 },

  trendRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  trendCol: {
    flex: 1, backgroundColor: "#111", borderRadius: 14, padding: 12, gap: 8,
    alignItems: "center", borderWidth: 1, borderColor: "#1e1e1e",
  },
  trendName: { fontSize: 13, fontWeight: "800" },
  trendNone: { color: "#6b6b6b", fontSize: 11 },

  legendRow: { flexDirection: "row", gap: 16, marginBottom: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: "#888", fontSize: 11.5, fontWeight: "700" },

  breakdownRow: { flexDirection: "row", gap: 10 },
  breakdownName: { fontSize: 13, fontWeight: "800", marginBottom: 4 },

  // Picker modal
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  modalSheet: {
    width: "100%", maxWidth: 560, alignSelf: "center",
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32,
    borderTopWidth: 1, borderColor: "#1e1e1e",
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 14 },
  modalTitle: { color: "#fff", fontSize: 17, fontWeight: "900", marginBottom: 14, textAlign: "center" },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#0a0a0a", borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 10,
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 15 },
  suggestLabel: {
    color: "#6b6b6b", fontSize: 10, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.2, marginVertical: 8,
  },
  resultRow: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  resultName: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700" },
  noResults: { color: "#777", textAlign: "center", paddingVertical: 24, fontSize: 14 },
});
