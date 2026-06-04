import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

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
  if (!role || role === "user") return null;
  const config = ROLE_CONFIG[role as Exclude<AppRole, "user">];
  if (!config) return null;

  return (
    <View style={styles.row}>
      <Ionicons name="checkmark-circle" size={size} color={config.color} />
      {showLabel && (
        <Text style={[styles.label, { color: config.color, fontSize: size - 3 }]}>
          {config.label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 3 },
  label: { fontWeight: "700", letterSpacing: 0.3 },
});
