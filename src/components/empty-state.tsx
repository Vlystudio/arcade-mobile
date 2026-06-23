import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Friendly empty-state with an icon, a line of copy, and an optional CTA.
 * Drop into any list/screen that can be empty so users get a nudge instead of
 * blank space.
 */
export function EmptyState({
  icon = "sparkles-outline",
  title,
  subtitle,
  ctaLabel,
  onPress,
  tone = "#06b6d4",
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onPress?: () => void;
  tone?: string;
}) {
  return (
    <View style={s.wrap}>
      <View style={[s.iconWrap, { backgroundColor: tone + "14", borderColor: tone + "33" }]}>
        <Ionicons name={icon} size={28} color={tone} />
      </View>
      <Text style={s.title}>{title}</Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      {ctaLabel && onPress ? (
        <Pressable style={[s.cta, { backgroundColor: tone }]} onPress={onPress}>
          <Text style={s.ctaText}>{ctaLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", paddingVertical: 44, paddingHorizontal: 32, gap: 4 },
  iconWrap: {
    width: 64, height: 64, borderRadius: 20, borderWidth: 1,
    alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  title: { color: "#fff", fontSize: 16, fontWeight: "800", textAlign: "center" },
  subtitle: { color: "#7a7a7a", fontSize: 13.5, lineHeight: 19, textAlign: "center", marginTop: 4, maxWidth: 300 },
  cta: { marginTop: 18, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 999 },
  ctaText: { color: "#001016", fontSize: 14, fontWeight: "800" },
});
