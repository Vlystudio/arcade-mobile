import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useRequireAuth } from "../hooks/use-require-auth";

export default function TriviaJoinScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [status, setStatus] = useState<"loading" | "joining" | "done" | "error">("loading");
  const [message, setMessage] = useState("");
  const [gameName, setGameName] = useState("");

  useEffect(() => {
    if (user && token) validateAndJoin();
  }, [user, token]);

  async function validateAndJoin() {
    setStatus("loading");
    const { data: game } = await supabase
      .from("trivia_games")
      .select("id, title, status")
      .eq("signup_token", token)
      .maybeSingle();

    if (!game) { setStatus("error"); setMessage("This QR code is invalid or expired."); return; }
    if (game.status !== "lobby") {
      setStatus("error");
      setMessage(game.status === "active" ? "This game has already started. You cannot join mid-game." : "This game has ended.");
      return;
    }
    setGameName(game.title);
    router.replace({ pathname: "/trivia", params: { token } } as any);
  }

  if (authLoading || status === "loading") {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator color="#06b6d4" size="large" />
          <Text style={s.loadingText}>Looking up trivia game...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.center}>
        <View style={[s.iconCircle, { backgroundColor: status === "error" ? "rgba(239,68,68,0.12)" : "rgba(6,182,212,0.12)" }]}>
          <Ionicons
            name={status === "error" ? "close-circle" : "checkmark-circle"}
            size={48}
            color={status === "error" ? "#ef4444" : "#06b6d4"}
          />
        </View>
        <Text style={s.title}>{status === "error" ? "Cannot Join" : "Redirecting..."}</Text>
        <Text style={s.body}>{message}</Text>
        <Pressable style={s.btn} onPress={() => router.replace("/trivia" as any)}>
          <Text style={s.btnText}>Go to Trivia</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36, gap: 16 },
  iconCircle: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { color: "#fff", fontSize: 22, fontWeight: "900", textAlign: "center" },
  body: { color: "#555", fontSize: 14, textAlign: "center", lineHeight: 20 },
  btn: { marginTop: 8, backgroundColor: "#06b6d4", borderRadius: 16, paddingVertical: 14, paddingHorizontal: 32 },
  btnText: { color: "#000", fontWeight: "900", fontSize: 15 },
  loadingText: { color: "#888", fontSize: 14, marginTop: 8 },
});
