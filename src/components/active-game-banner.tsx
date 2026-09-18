import { router, usePathname } from "expo-router";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useActiveGame } from "../context/active-game-context";
import { PressableScale } from "./pressable-scale";
import { usePractice } from "../context/practice-context";

export function ActiveGameBanner() {
  const { draft } = useActiveGame();
  const { state: practice, storage: practiceStorage } = usePractice();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  if (["/skeeball-tracker", "/scan-lane", "/team-detail", "/practice", "/start-game"].includes(path)) return null;
  if (!draft && practice.draft) return <PressableScale accessibilityLabel="Resume your practice game" style={[s.bar, { paddingTop: 12 + (Platform.OS === "web" ? 0 : insets.top) }]} onPress={() => router.push("/practice")}><View style={{ flex: 1 }}><Text style={s.title}>Practice in progress</Text><Text style={s.sub}>{practice.draft.balls.length}/9 balls · {practiceStorage === "saved" ? "saved on this device" : practiceStorage === "saving" ? "saving…" : "device save needs attention"}</Text></View><Text style={s.resume}>Resume →</Text></PressableScale>;
  if (!draft) return null;
  const balls = Object.values(draft.playerBalls).reduce((n, b) => n + b.length, 0);
  return <PressableScale accessibilityLabel={`Resume game on lane ${draft.lane}, ${balls} of 9 balls entered`} style={[s.bar, { paddingTop: 12 + (Platform.OS === "web" ? 0 : insets.top) }]}
    onPress={() => router.push({ pathname: "/skeeball-tracker", params: { teamId: draft.teamId, teamName: draft.teamName, sessionId: draft.sessionId } })}>
    <View style={{ flex: 1 }}><Text style={s.title}>Lane {draft.lane} · {balls === 9 ? "Ready to submit" : `Round ${Math.floor(balls / 3) + 1} of 3`}</Text><Text style={s.sub}>Game in progress · {balls}/9 balls</Text></View>
    <Text style={s.resume}>Resume →</Text>
  </PressableScale>;
}
const s = StyleSheet.create({ bar: { backgroundColor: "#082b33", borderBottomWidth: 1, borderColor: "#155e75", padding: 12, minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12 }, title: { color: "#fff", fontWeight: "800", fontSize: 14 }, sub: { color: "#a5d6df", fontSize: 12, marginTop: 3 }, resume: { color: "#67e8f9", fontWeight: "800", fontSize: 14 } });
