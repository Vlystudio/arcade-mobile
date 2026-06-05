import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// This screen is shown on native (iOS / Android).
// The full TV display only works in a browser — open it on a laptop or TV.

export default function KaraokeDisplayScreen() {
  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <View style={s.container}>
        <Ionicons name="tv-outline" size={52} color="#2a2a2a" />
        <Text style={s.title}>TV Display Screen</Text>
        <Text style={s.body}>
          Open this page in a browser on your TV or laptop. The YouTube player
          runs there and auto-advances songs with a 15-second countdown between
          each one.
        </Text>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/karaoke" as any)}>
          <Ionicons name="chevron-back" size={16} color="#fff" />
          <Text style={s.backBtnText}>Back to Queue</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#080808" },
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  title: { color: "#fff", fontSize: 22, fontWeight: "900", marginTop: 20, marginBottom: 14 },
  body: { color: "#555", fontSize: 15, lineHeight: 24, textAlign: "center", marginBottom: 36 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#a855f7", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 24 },
  backBtnText: { color: "#fff", fontWeight: "900", fontSize: 15 },
});
