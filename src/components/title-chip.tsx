import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { titleInfo } from "../../lib/titles";

/** Renders a user's equipped title as a small colored chip. Null if none. */
export function TitleChip({ titleKey, size = "md" }: { titleKey: string | null | undefined; size?: "sm" | "md" }) {
  const info = titleInfo(titleKey);
  if (!info) return null;
  const sm = size === "sm";
  const glow = info.glow
    ? { textShadowColor: info.color, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: sm ? 6 : 10 }
    : null;
  return (
    <View style={[s.chip, { backgroundColor: info.color + "1e", borderColor: info.color + "55" }, sm && s.chipSm]}>
      {!info.hideIcon && <Ionicons name={info.icon as any} size={sm ? 10 : 12} color={info.color} />}
      <Text style={[s.text, { color: info.color }, sm && s.textSm, glow]}>{info.label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderRadius: 999, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start",
  },
  chipSm: { paddingHorizontal: 8, paddingVertical: 2.5, gap: 4 },
  text: { fontSize: 12, fontWeight: "800", letterSpacing: 0.2 },
  textSm: { fontSize: 10.5 },
});
