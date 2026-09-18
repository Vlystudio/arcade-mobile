import { useEffect, useState } from "react";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { nextScoreTarget } from "../../lib/experience";
import { PressableScale } from "./pressable-scale";

type Nearby = { id: string; user_id: string; score: number; rank: number; name: string };
export function PersonalGoal({ game, best, userId }: { game: { id: string; name: string; type: string }; best?: number; userId: string }) {
  const [nearby, setNearby] = useState<Nearby[]>([]);
  useEffect(() => {
    let alive = true;
    setNearby([]);
    if (best == null) return;
    async function load() {
      const base = () => supabase.from("scores").select("id, user_id, score").eq("status", "approved").eq("game_id", game.id);
      const [above, below, own] = await Promise.all([
        base().gt("score", best!).neq("user_id", userId).order("score").order("id").limit(1),
        base().lte("score", best!).neq("user_id", userId).order("score", { ascending: false }).order("id").limit(1),
        base().eq("user_id", userId).eq("score", best!).order("id").limit(1),
      ]);
      if (above.error || below.error || own.error) return;
      const rows = [...above.data ?? [], ...own.data ?? [], ...below.data ?? []];
      const ids = [...new Set(rows.map(row => row.user_id))];
      if (!ids.length) return;
      const [profiles, ranks] = await Promise.all([
        supabase.from("public_profiles").select("id, username").in("id", ids),
        Promise.all(rows.map(row => supabase.from("scores").select("id", { count: "exact", head: true }).eq("status", "approved").eq("game_id", game.id).gt("score", row.score))),
      ]);
      if (ranks.some(r => r.error)) return;
      if (alive) setNearby(rows.map((row, index) => ({ ...row, rank: (ranks[index].count ?? 0) + 1, name: row.user_id === userId ? "You" : profiles.data?.find(p => p.id === row.user_id)?.username ?? "Player" })));
    }
    void load().catch(() => {});
    return () => { alive = false; };
  }, [game.id, best, userId]);
  const target = best == null ? null : nextScoreTarget(best, game.type);
  return <View style={s.card}>
    <Text style={s.eyebrow}>YOUR NEXT CHALLENGE · {game.name.toUpperCase()}</Text>
    <Text style={s.title}>{best == null ? "Set your first personal best" : target == null ? "A perfect game. Can you repeat it?" : `Aim for ${target.toLocaleString()}`}</Text>
    <Text style={s.sub}>{best == null ? "Play a game and submit a score to start your progress." : `Your approved best: ${best.toLocaleString()}${target ? ` · ${Math.round(target - best).toLocaleString()} to your next target` : ""}`}</Text>
    {nearby.length > 0 && <View style={s.board}>
      <Text style={s.sub}>Nearby approved scores</Text>
      {nearby.map(row => <View key={row.id} style={[s.row, row.user_id === userId && s.you]}>
        <Text style={s.rank}>#{row.rank}</Text><Text numberOfLines={1} style={s.name}>{row.name}</Text><Text style={s.score}>{row.score.toLocaleString()}</Text>
      </View>)}
    </View>}
    <PressableScale style={s.link} onPress={() => router.push({ pathname: "/leaderboard", params: { gameId: game.id } })}><Text style={s.linkText}>Explore the full leaderboard →</Text></PressableScale>
  </View>;
}
const s = StyleSheet.create({ card: { backgroundColor: "#0c1b20", borderColor: "#1b4650", borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 20, gap: 10 }, eyebrow: { color: "#67e8f9", fontSize: 11, letterSpacing: 1, fontWeight: "800" }, title: { color: "#fff", fontSize: 23, fontWeight: "800" }, sub: { color: "#b5c3ce", fontSize: 13, lineHeight: 20 }, board: { gap: 5, marginTop: 6 }, row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8 }, you: { backgroundColor: "#123640" }, rank: { color: "#9ca3af", minWidth: 35, fontSize: 13 }, name: { flex: 1, color: "#fff", fontWeight: "600" }, score: { color: "#67e8f9", fontWeight: "800", fontVariant: ["tabular-nums"] }, link: { minHeight: 44, justifyContent: "center" }, linkText: { color: "#67e8f9", fontWeight: "700", fontSize: 13 } });
