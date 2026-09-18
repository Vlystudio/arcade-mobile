import { Switch, Text, View } from "react-native";
import { useScoringAwake } from "../hooks/use-scoring-awake";
import { PLAY } from "./play-ui";

export function ScoringAwake({ active }: { active: boolean }) {
  const awake = useScoringAwake(active);
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52 }}>
    <View style={{ flex: 1 }}><Text style={{ color: PLAY.text, fontSize: 14, fontWeight: "700" }}>Keep screen awake</Text><Text accessibilityLiveRegion="polite" style={{ color: PLAY.muted, fontSize: 12, lineHeight: 18 }}>{awake.state === "unavailable" ? "Not available on this device right now" : awake.state === "on" ? "On while this game is open" : "Only while you’re actively scoring"}</Text></View>
    <Switch accessibilityLabel="Keep screen awake while scoring" value={awake.enabled} onValueChange={awake.setEnabled} trackColor={{ false: PLAY.border, true: "#167484" }} thumbColor={awake.enabled ? PLAY.accent : "#c1cbd1"} />
  </View>;
}
