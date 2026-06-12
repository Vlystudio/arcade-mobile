import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

export type AppRole = "user" | "admin" | "owner" | "architect";

export const ROLE_CONFIG: Record<Exclude<AppRole, "user">, { color: string; label: string }> = {
  admin:     { color: "#3b82f6", label: "Admin" },
  owner:     { color: "#f59e0b", label: "Owner" },
  architect: { color: "#a855f7", label: "Architect" },
};

export function isElevatedRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "owner" || role === "architect";
}

export function RoleBadge({
  role,
  showLabel = false,
  size = 14,
}: {
  role: string | null | undefined;
  showLabel?: boolean;
  size?: number;
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false);

  if (!role || role === "user") return null;
  const config = ROLE_CONFIG[role as Exclude<AppRole, "user">];
  if (!config) return null;

  function handlePress() {
    if (Platform.OS !== "web") {
      setTooltipVisible(true);
      setTimeout(() => setTooltipVisible(false), 2000);
    }
  }

  const displayLabel = showLabel || tooltipVisible;

  return (
    <Pressable
      style={styles.row}
      onPress={handlePress}
      onHoverIn={() => setTooltipVisible(true)}
      onHoverOut={() => setTooltipVisible(false)}
      hitSlop={8}
    >
      <Ionicons name="checkmark-circle" size={size} color={config.color} />
      {displayLabel && (
        <Text style={[styles.label, { color: config.color, fontSize: size - 3 }]}>
          {config.label}
        </Text>
      )}
    </Pressable>
  );
}

/** Beta-tester verification mark — separate from the role ladder. */
export function BetaBadge({
  visible,
  showLabel = false,
  size = 14,
}: {
  visible: boolean | null | undefined;
  showLabel?: boolean;
  size?: number;
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  if (!visible) return null;

  function handlePress() {
    if (Platform.OS !== "web") {
      setTooltipVisible(true);
      setTimeout(() => setTooltipVisible(false), 2000);
    }
  }

  const displayLabel = showLabel || tooltipVisible;

  return (
    <Pressable
      style={styles.row}
      onPress={handlePress}
      onHoverIn={() => setTooltipVisible(true)}
      onHoverOut={() => setTooltipVisible(false)}
      hitSlop={8}
    >
      <Ionicons name="flask" size={size} color="#2dd4bf" />
      {displayLabel && (
        <Text style={[styles.label, { color: "#2dd4bf", fontSize: size - 3 }]}>
          Beta Tester
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 3 },
  label: { fontWeight: "700", letterSpacing: 0.3 },
});
