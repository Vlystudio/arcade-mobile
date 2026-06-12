import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function AuthScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.logoSection}>
          <View style={styles.logoMark}>
            <Text style={styles.logoMarkText}>AT</Text>
          </View>
          <Text style={styles.appName}>ArcadeTracker</Text>
        </View>

        <View style={styles.noticeBanner}>
          <Ionicons name="game-controller-outline" size={18} color="#06b6d4" style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.noticeTitle}>Want to track your scores?</Text>
            <Text style={styles.noticeBody}>Create a free account to log high scores, join teams, enter tournaments, and appear on the leaderboard.</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.loginBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/login")}
          >
            <Text style={styles.loginBtnText}>Log In</Text>
            <Ionicons name="arrow-forward" size={18} color="#000" />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.registerBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/signup")}
          >
            <Text style={styles.registerBtnText}>Create Account</Text>
            <Ionicons name="person-add-outline" size={18} color="#fff" />
          </Pressable>

          <View style={styles.divider} />

          <Pressable
            style={({ pressed }) => [styles.foodBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/food" as any)}
          >
            <Ionicons name="restaurant-outline" size={18} color="#06b6d4" />
            <Text style={styles.foodBtnText}>Order Food</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.karaokeBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/karaoke" as any)}
          >
            <Ionicons name="mic-outline" size={18} color="#a855f7" />
            <Text style={styles.karaokeBtnText}>Karaoke Queue</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  container: { flex: 1, padding: 28, justifyContent: "center" },

  logoSection: { alignItems: "center", marginBottom: 72 },
  logoMark: {
    width: 88, height: 88, borderRadius: 28,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center", marginBottom: 20,
  },
  logoMarkText: { color: "#000", fontSize: 28, fontWeight: "900", letterSpacing: -1 },
  appName: { color: "#fff", fontSize: 32, fontWeight: "900", letterSpacing: -0.5, marginBottom: 8 },
  tagline: { color: "#777", fontSize: 15 },

  actions: { gap: 12 },
  loginBtn: {
    backgroundColor: "#06b6d4", borderRadius: 18,
    paddingVertical: 18, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 10,
  },
  loginBtnText: { color: "#000", fontWeight: "900", fontSize: 17 },

  registerBtn: {
    backgroundColor: "#111", borderRadius: 18, paddingVertical: 18,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  registerBtnText: { color: "#fff", fontWeight: "800", fontSize: 17 },

  divider: { height: 1, backgroundColor: "#1a1a1a", marginVertical: 4 },
  foodBtn: {
    borderRadius: 18, paddingVertical: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    borderWidth: 1, borderColor: "#06b6d4",
  },
  foodBtnText: { color: "#06b6d4", fontWeight: "800", fontSize: 17 },

  karaokeBtn: {
    borderRadius: 18, paddingVertical: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    borderWidth: 1, borderColor: "#a855f7",
  },
  karaokeBtnText: { color: "#a855f7", fontWeight: "800", fontSize: 17 },

  noticeBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    backgroundColor: "rgba(6,182,212,0.07)",
    borderWidth: 1, borderColor: "rgba(6,182,212,0.2)",
    borderRadius: 16, padding: 14, marginBottom: 20,
  },
  noticeTitle: { color: "#06b6d4", fontSize: 13, fontWeight: "800", marginBottom: 3 },
  noticeBody: { color: "#8a8a8a", fontSize: 13, lineHeight: 19 },
});
