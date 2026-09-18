import { StyleSheet, Text, View, type ViewStyle, type StyleProp } from "react-native";
import { PressableScale } from "./pressable-scale";

export const PLAY = { background: "#080d11", surface: "#131c23", elevated: "#1c2933", border: "#2b3c47", text: "#f5f8fa", muted: "#b1c1cc", accent: "#39d5ec", success: "#80e4b0", gold: "#ffd080" };
export const playStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: PLAY.background }, content: { padding: 20, gap: 20, paddingBottom: 36 },
  title: { color: PLAY.text, fontSize: 30, fontWeight: "900", letterSpacing: -0.7 }, subtitle: { color: PLAY.muted, fontSize: 15, lineHeight: 22 },
  label: { color: PLAY.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  card: { backgroundColor: PLAY.surface, borderRadius: 20, padding: 20, gap: 14 }, row: { flexDirection: "row", alignItems: "center", gap: 12 },
  input: { backgroundColor: PLAY.elevated, borderWidth: 1, borderColor: PLAY.border, color: PLAY.text, borderRadius: 12, minHeight: 52, paddingHorizontal: 14, fontSize: 16 },
  error: { color: "#ffc2b9", fontSize: 14, lineHeight: 20 },
});
export function PlayButton({ label, onPress, secondary, disabled, style }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return <PressableScale accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={[{ minHeight: 52, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 14, alignItems: "center", justifyContent: "center", backgroundColor: secondary ? PLAY.elevated : PLAY.accent, opacity: disabled ? 0.55 : 1 }, style]}>
    <Text style={{ color: secondary ? PLAY.text : "#031319", fontWeight: "800", fontSize: 16, textAlign: "center" }}>{label}</Text>
  </PressableScale>;
}
export function SaveStatus({ local, syncing = false, remoteError, synced = false, onRetry }: {
  local: "saving" | "saved" | "error"; syncing?: boolean; remoteError?: boolean; synced?: boolean; onRetry?: () => void;
}) {
  const label = local === "error" ? "Device save failed · keep this game open" : local === "saving" ? "Saving on this phone…" : remoteError ? "Saved on this phone · sync needs attention" : syncing ? "Saved on this phone · syncing…" : synced ? "Synced" : "Saved on this phone";
  return <View style={[playStyles.row, { minHeight: 44, justifyContent: "space-between", flexWrap: "wrap" }]}>
    <Text accessibilityLiveRegion="polite" style={{ color: local === "error" || remoteError ? PLAY.gold : synced ? PLAY.success : PLAY.muted, fontSize: 13, lineHeight: 20, flexShrink: 1 }}>{label}</Text>
    {(local === "error" || remoteError) && onRetry && <PressableScale accessibilityRole="button" accessibilityLabel="Retry saving this game" onPress={onRetry} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: "center" }}><Text style={{ color: PLAY.accent, fontWeight: "800" }}>Retry</Text></PressableScale>}
  </View>;
}

