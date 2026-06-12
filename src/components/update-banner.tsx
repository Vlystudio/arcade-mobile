import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";

/**
 * Checks for a downloaded OTA update and offers a one-tap restart, so
 * users never need to know about the "close the app twice" dance.
 * No-op on web (the browser refreshes itself) and in dev.
 */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web" || __DEV__) return;
    let mounted = true;
    (async () => {
      try {
        const Updates = require("expo-updates");
        if (!Updates.isEnabled) return;
        const check = await Updates.checkForUpdateAsync();
        if (check.isAvailable) {
          await Updates.fetchUpdateAsync();
          if (mounted) setReady(true);
        }
      } catch {
        // updates module unavailable or offline — stay silent
      }
    })();
    return () => { mounted = false; };
  }, []);

  if (!ready) return null;

  return (
    <Pressable
      style={s.banner}
      onPress={() => {
        try { require("expo-updates").reloadAsync(); } catch {}
      }}
    >
      <Ionicons name="sparkles" size={14} color="#000" />
      <Text style={s.text}>A new version is ready — tap to update</Text>
      <Ionicons name="refresh" size={14} color="#000" />
    </Pressable>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#06b6d4",
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  text: { color: "#000", fontSize: 13, fontWeight: "800" },
});
