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
import { ScoreText } from "../components/score-text";
import {
  fetchPlayerStats,
  fetchSkeeSeasons,
  fetchStandings,
  type PlayerStats,
  type SkeeSeason,
  type StandingRow,
} from "../lib/skeeball-stats";

type PickedUser = { id: string; username: string; avatar_url: string | null };
type PickedTeam = StandingRow & { rank: number };
type Mode = "players" | "teams";

const COLORS = ["#06b6d4", "#a855f7", "#f59e0b", "#22c55e"];
const MAX_PLAYERS = 3;
const MAX_TEAMS = 4;

export default function SkeeballCompareScreen() {
  const { teamId } = useLocalSearchParams<{ teamId?: string }>();
  const { user, loading: authLoading } = useRequireAuth();

  const [mode, setMode] = useState<Mode>("players");
  const [seasons, setSeasons] = useState<SkeeSeason[]>([]);
  const [scopeId, setScopeId] = useState<string | "all">("all");

  // Players (up to 3)
  const [players, setPlayers] = useState<(PickedUser | null)[]>([null, null, null]);
  const [stats, setStats] = useState<(PlayerStats | null)[]>([null, null, null]);
  const [loadingStats, setLoadingStats] = useState(false);

  // Teams (up to 4)
  const [standings, setStandings] = useState<PickedTeam[]>([]);
  const [teams, setTeams] = useState<(PickedTeam | null)[]>([null, null, null, null]);

  // Picker modal
  const [pickerFor, setPickerFor] = useState<{ mode: Mode; index: number } | null>(null);
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

  // Player stats follow selections + scope
  useEffect(() => {
    if (!players.some(Boolean)) return;
    setLoadingStats(true);
    Promise.all(players.map((p) => (p ? fetchPlayerStats(p.id, scope) : Promise.resolve(null))))
      .then((rows) => { setStats(rows); setLoadingStats(false); });
  }, [players.map((p) => p?.id).join(","), scopeId, seasons.length]);

  // Standings follow scope; re-resolve selected teams against the new scope
  useEffect(() => {
    if (!user) return;
    fetchStandings(scope).then((rows) => {
      const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
      setStandings(ranked);
      setTeams((prev) => prev.map((t) => (t ? ranked.find((r) => r.team_id === t.team_id) ?? null : null)));
    });
  }, [user, scopeId, seasons.length]);

  async function searchUsers(q: string) {
    setSearch(q);
    if (pickerFor?.mode === "teams") return; // teams filter locally
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

  function closePicker() { setPickerFor(null); setSearch(""); setResults([]); }

  function pickUser(u: PickedUser) {
    if (pickerFor?.mode !== "players") return;
    setPlayers((prev) => prev.map((p, i) => (i === pickerFor.index ? u : p)));
    closePicker();
  }

  function pickTeam(t: PickedTeam) {
    if (pickerFor?.mode !== "teams") return;
    setTeams((prev) => prev.map((p, i) => (i === pickerFor.index ? t : p)));
    closePicker();
  }

  function clearSlot(m: Mode, index: number) {
    if (m === "players") setPlayers((prev) => prev.map((p, i) => (i === index ? null : p)));
    else setTeams((prev) => prev.map((p, i) => (i === index ? null : p)));
  }

  if (authLoading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  const pickedPlayers = players.map((p, i) => ({ p, st: stats[i], color: COLORS[i] })).filter((x) => x.p) as { p: PickedUser; st: PlayerStats | null; color: string }[];
  const pickedTeams = teams.map((t, i) => ({ t, color: COLORS[i] })).filter((x) => x.t) as { t: PickedTeam; color: string }[];
  const suggestions = teamMembers.filter((m) => !players.some((p) => p?.id === m.id));
  const teamOptions = standings.filter((r) =>
    !teams.some((t) => t?.team_id === r.team_id) &&
    (search.trim() === "" || r.team_name.toLowerCase().includes(search.trim().toLowerCase()))
  );

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/teams" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Compare</Text>
          <Text style={s.headerSub}>Skee-Ball League head-to-head</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        {/* Mode tabs */}
        <View style={s.modeRow}>
          <Pressable style={[s.modeBtn, mode === "players" && s.modeBtnActive]} onPress={() => setMode("players")}>
            <Ionicons name="person-outline" size={14} color={mode === "players" ? "#06b6d4" : "#7a7a7a"} />
            <Text style={[s.modeText, mode === "players" && s.modeTextActive]}>Players (up to {MAX_PLAYERS})</Text>
          </Pressable>
          <Pressable style={[s.modeBtn, mode === "teams" && s.modeBtnActive]} onPress={() => setMode("teams")}>
            <Ionicons name="people-outline" size={14} color={mode === "teams" ? "#06b6d4" : "#7a7a7a"} />
            <Text style={[s.modeText, mode === "teams" && s.modeTextActive]}>Teams (up to {MAX_TEAMS})</Text>
          </Pressable>
        </View>

        {/* Slots */}
        {mode === "players" ? (
          <View style={s.slotsRow}>
            {players.map((p, i) => (
              <CompareSlot
                key={i}
                label={p?.username ?? "Add player"}
                avatar={p ? { uri: p.avatar_url, name: p.username } : null}
                color={COLORS[i]}
                picked={!!p}
                onPress={() => setPickerFor({ mode: "players", index: i })}
                onClear={() => clearSlot("players", i)}
              />
            ))}
          </View>
        ) : (
          <View style={s.slotsRowWrap}>
            {teams.map((t, i) => (
              <CompareSlot
                key={i}
                label={t?.team_name ?? "Add team"}
                avatar={t ? { uri: null, name: t.team_name } : null}
                color={COLORS[i]}
                picked={!!t}
                half
                onPress={() => setPickerFor({ mode: "teams", index: i })}
                onClear={() => clearSlot("teams", i)}
              />
            ))}
          </View>
        )}

        {/* Season scope */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 18 }} contentContainerStyle={s.scopeRow}>
          <Pressable style={[s.scopeChip, scopeId === "all" && s.scopeChipActive]} onPress={() => setScopeId("all")}>
            <Text style={[s.scopeChipText, scopeId === "all" && s.scopeChipTextActive]}>All Seasons</Text>
          </Pressable>
          {seasons.map((sn) => (
            <Pressable key={sn.id} style={[s.scopeChip, scopeId === sn.id && s.scopeChipActive]} onPress={() => setScopeId(sn.id)}>
              {sn.status === "active" && <View style={s.liveDot} />}
              <Text style={[s.scopeChipText, scopeId === sn.id && s.scopeChipTextActive]}>{sn.name}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* ── Players comparison ── */}
        {mode === "players" && (pickedPlayers.length < 2 ? (
          <EmptyCompare what="players" min={2} max={MAX_PLAYERS} />
        ) : loadingStats ? (
          <ActivityIndicator color="#06b6d4" style={{ marginTop: 40 }} />
        ) : (
          <>
            <NameHeader items={pickedPlayers.map((x) => ({ name: x.p.username, color: x.color }))} />
            <View style={s.card}>
              <MultiRow label="Avg Score" values={pickedPlayers.map((x) => x.st?.totals.avg)} colors={pickedPlayers.map((x) => x.color)} higherWins />
              <MultiRow label="Best Game" values={pickedPlayers.map((x) => x.st?.totals.best)} colors={pickedPlayers.map((x) => x.color)} higherWins />
              <MultiRow label="Games Played" values={pickedPlayers.map((x) => x.st?.totals.games)} colors={pickedPlayers.map((x) => x.color)} />
              <MultiRow label="Balls Thrown" values={pickedPlayers.map((x) => x.st?.totals.balls)} colors={pickedPlayers.map((x) => x.color)} last />
            </View>

            <View style={s.trendRow}>
              {pickedPlayers.map((x) => (
                <View key={x.p.id} style={s.trendCol}>
                  <Text style={[s.trendName, { color: x.color }]} numberOfLines={1}>{x.p.username}</Text>
                  {x.st && x.st.weeks.length >= 2 ? <TrendBadge weeks={x.st.weeks} /> : <Text style={s.trendNone}>Not enough weeks</Text>}
                </View>
              ))}
            </View>

            {pickedPlayers.length === 2 && (
              <>
                <Text style={s.sectionLabel}>Weekly Averages</Text>
                <View style={s.card}>
                  <View style={s.legendRow}>
                    {pickedPlayers.map((x) => (
                      <View key={x.p.id} style={s.legendItem}><View style={[s.legendDot, { backgroundColor: x.color }]} /><Text style={s.legendText}>{x.p.username}</Text></View>
                    ))}
                  </View>
                  <WeeklyBarChart
                    weeks={pickedPlayers[0].st?.weeks ?? []}
                    compareWeeks={pickedPlayers[1].st?.weeks ?? []}
                    season={scope}
                    color={pickedPlayers[0].color}
                    compareColor={pickedPlayers[1].color}
                    height={130}
                  />
                </View>
              </>
            )}

            <Text style={s.sectionLabel}>Shot Breakdown</Text>
            <View style={s.breakdownRow}>
              {pickedPlayers.map((x) => (
                <View key={x.p.id} style={[s.card, { flex: 1 }]}>
                  <Text style={[s.breakdownName, { color: x.color }]} numberOfLines={1}>{x.p.username}</Text>
                  <RingBreakdown rings={x.st?.totals.rings ?? {}} compact />
                </View>
              ))}
            </View>
          </>
        ))}

        {/* ── Teams comparison ── */}
        {mode === "teams" && (pickedTeams.length < 2 ? (
          <EmptyCompare what="teams" min={2} max={MAX_TEAMS} />
        ) : (
          <>
            <NameHeader items={pickedTeams.map((x) => ({ name: x.t.team_name, color: x.color }))} />
            <View style={s.card}>
              <MultiRow label="Rank" values={pickedTeams.map((x) => x.t.rank)} colors={pickedTeams.map((x) => x.color)} higherWins={false} lowerWins prefix="#" />
              <MultiRow label="League Pts" values={pickedTeams.map((x) => x.t.total_points)} colors={pickedTeams.map((x) => x.color)} higherWins />
              <MultiRow label="Avg Game" values={pickedTeams.map((x) => x.t.avg_score != null ? Math.round(x.t.avg_score) : null)} colors={pickedTeams.map((x) => x.color)} higherWins />
              <MultiRow label="Best Game" values={pickedTeams.map((x) => x.t.best_score)} colors={pickedTeams.map((x) => x.color)} higherWins />
              <MultiRow label="Games" values={pickedTeams.map((x) => x.t.matches_played)} colors={pickedTeams.map((x) => x.color)} />
              <MultiRow label="🥇 Gold" values={pickedTeams.map((x) => x.t.gold)} colors={pickedTeams.map((x) => x.color)} higherWins />
              <MultiRow label="🥈 Silver" values={pickedTeams.map((x) => x.t.silver)} colors={pickedTeams.map((x) => x.color)} />
              <MultiRow label="🥉 Bronze" values={pickedTeams.map((x) => x.t.bronze)} colors={pickedTeams.map((x) => x.color)} last />
            </View>
            <Text style={s.footnote}>
              Stats reflect the selected season scope. Rank is the team's position in those standings.
            </Text>
          </>
        ))}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Picker modal */}
      <Modal visible={pickerFor !== null} transparent animationType="slide" onRequestClose={closePicker}>
        <View style={s.modalBg}>
          <Pressable style={s.modalDismiss} onPress={closePicker} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>
              {pickerFor?.mode === "teams" ? `Select Team ${(pickerFor?.index ?? 0) + 1}` : `Select Player ${(pickerFor?.index ?? 0) + 1}`}
            </Text>
            <View style={s.searchWrap}>
              <Ionicons name="search-outline" size={16} color="#444" />
              <TextInput
                style={s.searchInput}
                placeholder={pickerFor?.mode === "teams" ? "Search teams…" : "Search by username…"}
                placeholderTextColor="#6e6e6e"
                autoFocus
                autoCapitalize="none"
                value={search}
                onChangeText={searchUsers}
              />
              {searching && <ActivityIndicator size="small" color="#6e6e6e" />}
            </View>
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              {pickerFor?.mode === "teams" ? (
                <>
                  {teamOptions.map((r) => (
                    <Pressable key={r.team_id} style={s.resultRow} onPress={() => pickTeam(r as PickedTeam)}>
                      <View style={s.teamBubble}><Text style={s.teamBubbleText}>{r.team_name.slice(0, 2).toUpperCase()}</Text></View>
                      <Text style={s.resultName}>{r.team_name}</Text>
                      <Text style={s.resultMeta}>#{(r as PickedTeam).rank} · {r.total_points} pts</Text>
                      <Ionicons name="add-circle-outline" size={20} color="#06b6d4" />
                    </Pressable>
                  ))}
                  {teamOptions.length === 0 && <Text style={s.noResults}>No teams with league games in this scope</Text>}
                </>
              ) : (
                <>
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
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function CompareSlot({ label, avatar, color, picked, half, onPress, onClear }: {
  label: string;
  avatar: { uri: string | null; name: string } | null;
  color: string;
  picked: boolean;
  half?: boolean;
  onPress: () => void;
  onClear: () => void;
}) {
  return (
    <Pressable style={[s.slot, half && s.slotHalf, picked && { borderColor: `${color}50` }]} onPress={onPress}>
      {picked && (
        <Pressable style={s.slotClear} hitSlop={8} onPress={onClear}>
          <Ionicons name="close-circle" size={16} color="#6e6e6e" />
        </Pressable>
      )}
      {avatar ? (
        <>
          <Avatar uri={avatar.uri} name={avatar.name} size={40} />
          <Text style={[s.slotName, { color }]} numberOfLines={1}>{label}</Text>
        </>
      ) : (
        <>
          <View style={s.slotAdd}>
            <Ionicons name="add" size={18} color="#6e6e6e" />
          </View>
          <Text style={s.slotPlaceholder} numberOfLines={1}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

function EmptyCompare({ what, min, max }: { what: string; min: number; max: number }) {
  return (
    <View style={s.emptyCard}>
      <Ionicons name="git-compare-outline" size={36} color="#333" />
      <Text style={s.emptyTitle}>Pick at least {min} {what}</Text>
      <Text style={s.emptySub}>Select {min}–{max} {what} above to compare side by side. The best number in each row lights up.</Text>
    </View>
  );
}

function NameHeader({ items }: { items: { name: string; color: string }[] }) {
  return (
    <View style={s.nameHeader}>
      <View style={{ width: 92 }} />
      {items.map((it, i) => (
        <Text key={i} style={[s.nameHeaderText, { color: it.color }]} numberOfLines={1}>{it.name}</Text>
      ))}
    </View>
  );
}

function MultiRow({ label, values, colors, higherWins, lowerWins, last, prefix = "" }: {
  label: string;
  values: (number | null | undefined)[];
  colors: string[];
  higherWins?: boolean;
  lowerWins?: boolean;
  last?: boolean;
  prefix?: string;
}) {
  const nums = values.map((v) => v ?? null);
  const present = nums.filter((v): v is number => v !== null);
  const best = present.length >= 2
    ? (lowerWins ? Math.min(...present) : higherWins ? Math.max(...present) : null)
    : null;
  return (
    <View style={[s.multiRow, !last && s.compareRowBorder]}>
      <Text style={s.multiLabel}>{label}</Text>
      {nums.map((v, i) => {
        const wins = best !== null && v === best;
        return v === null ? (
          <Text key={i} style={[s.multiVal, { color: "#6e6e6e" }]}>—</Text>
        ) : (
          <ScoreText
            key={i}
            value={v}
            prefix={prefix}
            style={[s.multiVal, { color: wins ? colors[i] : "#999" }, wins && s.multiValWin]}
          />
        );
      })}
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
  headerSub: { color: "#8a8a8a", fontSize: 12, marginTop: 1 },

  modeRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  modeBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#0d0d0d", borderRadius: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  modeBtnActive: { borderColor: "rgba(6,182,212,0.4)", backgroundColor: "rgba(6,182,212,0.08)" },
  modeText: { color: "#8a8a8a", fontSize: 12.5, fontWeight: "700" },
  modeTextActive: { color: "#06b6d4", fontWeight: "800" },

  slotsRow: { flexDirection: "row", alignItems: "stretch", gap: 8, marginBottom: 14 },
  slotsRowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  slot: {
    flex: 1, alignItems: "center", gap: 6,
    backgroundColor: "#111", borderRadius: 16, padding: 12,
    borderWidth: 1.5, borderColor: "#1a1a1a",
    minWidth: 0,
  },
  slotHalf: { flexBasis: "47%", flexGrow: 1 },
  slotClear: { position: "absolute", top: 6, right: 6, zIndex: 2 },
  slotName: { fontSize: 12.5, fontWeight: "800", maxWidth: "100%" },
  slotAdd: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#2a2a2a", borderStyle: "dashed",
  },
  slotPlaceholder: { color: "#8a8a8a", fontSize: 12, fontWeight: "600" },

  scopeRow: { gap: 8, alignItems: "center" },
  scopeChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#111", borderRadius: 18, paddingHorizontal: 13, paddingVertical: 7,
    borderWidth: 1, borderColor: "#1a1a1a",
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
    borderWidth: 1, borderColor: "#1a1a1a", marginBottom: 14, gap: 8,
  },

  nameHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, marginBottom: 6 },
  nameHeaderText: { flex: 1, fontSize: 12, fontWeight: "900", textAlign: "center" },

  multiRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  multiLabel: { width: 92, color: "#8a8a8a", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  multiVal: { flex: 1, fontSize: 15, fontWeight: "900", textAlign: "center" },
  multiValWin: { fontSize: 17 },
  compareRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  footnote: { color: "#6e6e6e", fontSize: 11.5, lineHeight: 16, marginBottom: 8 },

  trendRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  trendCol: {
    flex: 1, backgroundColor: "#111", borderRadius: 14, padding: 12, gap: 8,
    alignItems: "center", borderWidth: 1, borderColor: "#1a1a1a",
  },
  trendName: { fontSize: 13, fontWeight: "800" },
  trendNone: { color: "#6b6b6b", fontSize: 11 },

  legendRow: { flexDirection: "row", gap: 16, marginBottom: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: "#999", fontSize: 11.5, fontWeight: "700" },

  breakdownRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  breakdownName: { fontSize: 13, fontWeight: "800", marginBottom: 4 },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  modalSheet: {
    width: "100%", maxWidth: 560, alignSelf: "center",
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32,
    borderTopWidth: 1, borderColor: "#1a1a1a",
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 14 },
  modalTitle: { color: "#fff", fontSize: 17, fontWeight: "900", marginBottom: 14, textAlign: "center" },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#0a0a0a", borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: "#1a1a1a", marginBottom: 10,
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
  resultMeta: { color: "#8a8a8a", fontSize: 12, fontWeight: "600" },
  noResults: { color: "#8a8a8a", textAlign: "center", paddingVertical: 24, fontSize: 14 },
  teamBubble: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(6,182,212,0.1)",
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(6,182,212,0.25)",
  },
  teamBubbleText: { color: "#06b6d4", fontSize: 13, fontWeight: "900" },
});
