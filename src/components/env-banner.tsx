import * as Updates from "expo-updates";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

type EnvInfo = { label: string; bg: string; fg: string };

function getEnvInfo(): EnvInfo | null {
  const branch =
    process.env.EXPO_PUBLIC_GIT_BRANCH ??
    (Platform.OS !== "web" ? Updates.channel : undefined) ??
    "";

  if (branch === "sandbox") return { label: "SANDBOX", bg: "#f59e0b", fg: "#000000" };
  if (branch === "staging") return { label: "STAGING / QA", bg: "#3b82f6", fg: "#ffffff" };
  return null;
}

export function EnvBanner() {
  const env = getEnvInfo();
  if (!env) return null;

  return (
    <View style={[styles.banner, { backgroundColor: env.bg }]}>
      <Text style={[styles.text, { color: env.fg }]}>{env.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    width: "100%",
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 1.5,
  },
});
