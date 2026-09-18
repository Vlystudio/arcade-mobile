import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { PressableScale } from "./pressable-scale";
import { MotionView } from "./motion";

export function SessionFinish({ players, previousBest, userId, placement, leaguePoints, onDone, onAgain, playingAgain, groupGame }: {
  players: { id: string; name: string; score: number }[]; previousBest: number | null;
  userId?: string; placement?: number | null; leaguePoints?: number | null; onDone: () => void;
  onAgain?: () => void; playingAgain?: boolean;
  groupGame?: boolean;
}) {
  const mine = groupGame ? undefined : players.find(p => p.id === userId);
  const total = players.reduce((sum, p) => sum + p.score, 0);
  const difference = mine && previousBest != null ? mine.score - previousBest : null;
  const improvement = difference == null ? "Your next personal best starts here." : difference > 0 ? `New personal best! ${difference} points above your previous best.` : difference === 0 ? "You matched your personal best." : `${-difference} points to your personal best of ${previousBest}.`;
  async function share() {
    try { await Share.share({ message: [`Our Skee-Ball game: ${total} points`, mine ? `My score: ${mine.score}. ${improvement}` : "", placement ? `Team finished #${placement}${leaguePoints != null ? ` · ${leaguePoints} league points` : ""}` : "", "https://www.vlystudios.com"].filter(Boolean).join("\n") }); } catch { /* sharing can be cancelled */ }
  }
  return <ScrollView contentContainerStyle={s.scroll}>
    <MotionView><View style={s.hero}>
      <Ionicons name="checkmark-circle" size={54} color="#22d3ee" />
      <Text style={s.title}>That’s a wrap.</Text>
      <Text style={s.sub}>Your game is saved. The lane is ready for the next team.</Text>
      <Text style={s.score}>{mine?.score ?? total}</Text><Text style={s.label}>{groupGame ? "GROUP SCORE" : mine ? "YOUR SCORE" : "TEAM SCORE"}</Text>
      {mine && <Text style={s.improvement}>{improvement}</Text>}
    </View></MotionView>
    <View style={s.results}>
      <Text style={s.resultTitle}>Team total · {total}</Text>
      <Text style={s.sub}>{placement ? `Finished #${placement}${leaguePoints != null ? ` · ${leaguePoints} league points` : ""}` : "League placement will appear when the round is final."}</Text>
      {players.map(p => <View style={s.row} key={p.id}><Text style={s.name}>{p.name}{!groupGame && p.id === userId ? " (you)" : ""}</Text><Text style={s.value}>{p.score}</Text></View>)}
    </View>
    {onAgain && <PressableScale style={s.primary} disabled={playingAgain} onPress={onAgain}><Text style={s.primaryText}>{playingAgain ? "Starting…" : "Play again with this group"}</Text></PressableScale>}
    <PressableScale style={onAgain ? s.secondary : s.primary} onPress={() => router.push("/skeeball-recap")}><Text style={onAgain ? s.secondaryText : s.primaryText}>See your night recap</Text></PressableScale>
    <PressableScale style={s.secondary} onPress={onDone}><Text style={s.secondaryText}>Back to your team</Text></PressableScale>
    <PressableScale style={s.secondary} onPress={share}><Text style={s.share}>Share this game</Text></PressableScale>
  </ScrollView>;
}
const s = StyleSheet.create({ scroll: { padding: 22, paddingBottom: 32, gap: 12 }, hero: { alignItems: "center", paddingVertical: 22, gap: 12 }, title: { fontSize: 32, color: "#fff", fontWeight: "900" }, sub: { color: "#b4bec9", lineHeight: 22, fontSize: 14 }, score: { color: "#67e8f9", fontSize: 64, fontWeight: "900", fontVariant: ["tabular-nums"] }, label: { color: "#9cabb7", fontSize: 12, letterSpacing: 2 }, improvement: { color: "#fcd34d", textAlign: "center", fontSize: 15, lineHeight: 22 }, results: { borderRadius: 18, backgroundColor: "#151a1e", padding: 18, gap: 12 }, resultTitle: { color: "#fff", fontWeight: "800", fontSize: 18 }, row: { flexDirection: "row", gap: 10, justifyContent: "space-between", paddingVertical: 5 }, name: { color: "#cbd5e1", flex: 1 }, value: { color: "#fff", fontWeight: "800" }, primary: { minHeight: 50, borderRadius: 14, backgroundColor: "#22d3ee", padding: 15, alignItems: "center", justifyContent: "center" }, primaryText: { color: "#001016", fontSize: 15, fontWeight: "800" }, secondary: { minHeight: 48, alignItems: "center", justifyContent: "center" }, secondaryText: { color: "#fff", fontWeight: "700" }, share: { color: "#67e8f9", fontWeight: "700" } });
