import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../context/auth-context";
import { supabase } from "../../lib/supabase";

type State = "loading" | "success" | "already" | "full" | "inactive" | "auth" | "error";

export default function FFSignupScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<State>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const called = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setState("auth"); return; }
    if (!token || called.current) return;
    called.current = true;
    signUp();
  }, [authLoading, user, token]);

  async function signUp() {
    setState("loading");
    const { data, error } = await supabase.rpc("rpc_ff_qr_signup", {
      p_token: token,
    });
    if (error) { setState("error"); setErrorMsg(error.message); return; }
    const result = data as any;
    if (result?.ok) {
      setPlayerCount(result.players_registered ?? null);
      setState("success");
      return;
    }
    switch (result?.error) {
      case "already_registered": setState("already"); break;
      case "full":               setState("full"); break;
      case "invalid_or_inactive":setState("inactive"); break;
      default:
        setState("error");
        setErrorMsg(result?.message ?? result?.error ?? "Something went wrong.");
    }
  }

  if (authLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#06b6d4" />
      </View>
    );
  }

  if (state === "auth") {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.card}>
          <View style={s.iconWrap}>
            <Ionicons name="lock-closed-outline" size={32} color="#f59e0b" />
          </View>
          <Text style={s.title}>Sign in required</Text>
          <Text style={s.sub}>You need an ArcadeTracker account to sign up for this tournament.</Text>
          <Pressable style={s.primaryBtn} onPress={() => router.replace("/login")}>
            <Text style={s.primaryBtnText}>Sign in</Text>
          </Pressable>
          <Pressable style={s.secondaryBtn} onPress={() => router.replace("/signup")}>
            <Text style={s.secondaryBtnText}>Create account</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state === "loading") {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.card}>
          <ActivityIndicator size="large" color="#06b6d4" style={{ marginBottom: 16 }} />
          <Text style={s.sub}>Registering you for the tournament…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state === "success") {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.card}>
          <View style={[s.iconWrap, { backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.25)" }]}>
            <Ionicons name="checkmark-circle" size={40} color="#22c55e" />
          </View>
          <Text style={s.title}>You're in!</Text>
          <Text style={s.sub}>
            You've been registered for First Friday Skee-Ball.{"\n"}See you on the first Friday!
          </Text>
          {playerCount !== null && (
            <View style={s.countRow}>
              <Ionicons name="people" size={14} color="#444" />
              <Text style={s.countText}>{playerCount}/20 players registered</Text>
            </View>
          )}
          <Pressable style={s.primaryBtn} onPress={() => router.replace("/tournaments" as any)}>
            <Text style={s.primaryBtnText}>View Tournaments</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state === "already") {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.card}>
          <View style={[s.iconWrap, { backgroundColor: "rgba(6,182,212,0.1)", borderColor: "rgba(6,182,212,0.25)" }]}>
            <Ionicons name="checkmark-done-circle" size={40} color="#06b6d4" />
          </View>
          <Text style={s.title}>Already registered</Text>
          <Text style={s.sub}>You're already signed up for this tournament. See you on the first Friday!</Text>
          <Pressable style={s.primaryBtn} onPress={() => router.replace("/tournaments" as any)}>
            <Text style={s.primaryBtnText}>View Tournaments</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state === "full") {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.card}>
          <View style={[s.iconWrap, { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.2)" }]}>
            <Ionicons name="people" size={36} color="#ef4444" />
          </View>
          <Text style={s.title}>Tournament full</Text>
          <Text style={s.sub}>All 20 spots have been filled. Come early next month to get your spot!</Text>
          <Pressable style={s.primaryBtn} onPress={() => router.replace("/tournaments" as any)}>
            <Text style={s.primaryBtnText}>View Tournaments</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (state === "inactive") {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.card}>
          <View style={[s.iconWrap, { backgroundColor: "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.2)" }]}>
            <Ionicons name="qr-code-outline" size={36} color="#f59e0b" />
          </View>
          <Text style={s.title}>QR code inactive</Text>
          <Text style={s.sub}>This sign-up QR is no longer active. Ask staff to open sign-ups.</Text>
          <Pressable style={s.primaryBtn} onPress={() => router.replace("/tournaments" as any)}>
            <Text style={s.primaryBtnText}>View Tournaments</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // error
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.card}>
        <View style={[s.iconWrap, { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.2)" }]}>
          <Ionicons name="alert-circle-outline" size={36} color="#ef4444" />
        </View>
        <Text style={s.title}>Something went wrong</Text>
        <Text style={s.sub}>{errorMsg || "Unable to process sign-up. Please try again."}</Text>
        <Pressable style={s.primaryBtn} onPress={() => { called.current = false; signUp(); }}>
          <Text style={s.primaryBtnText}>Try Again</Text>
        </Pressable>
        <Pressable style={s.secondaryBtn} onPress={() => router.replace("/tournaments" as any)}>
          <Text style={s.secondaryBtnText}>Back to Tournaments</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  card: {
    flex: 1, alignItems: "center", justifyContent: "center",
    padding: 32,
  },
  iconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "rgba(6,182,212,0.08)", borderWidth: 1.5,
    borderColor: "rgba(6,182,212,0.2)", alignItems: "center", justifyContent: "center",
    marginBottom: 24,
  },
  title: {
    color: "#fff", fontSize: 26, fontWeight: "900",
    letterSpacing: -0.5, marginBottom: 10, textAlign: "center",
  },
  sub: {
    color: "#555", fontSize: 15, textAlign: "center",
    lineHeight: 22, marginBottom: 24,
  },
  countRow: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "#111", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 24,
  },
  countText: { color: "#555", fontSize: 13, fontWeight: "600" },
  primaryBtn: {
    backgroundColor: "#06b6d4", borderRadius: 16,
    paddingVertical: 16, paddingHorizontal: 40,
    alignItems: "center", marginBottom: 12, width: "100%",
  },
  primaryBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
  secondaryBtn: {
    borderRadius: 16, paddingVertical: 14, paddingHorizontal: 40,
    alignItems: "center", borderWidth: 1, borderColor: "#1e1e1e", width: "100%",
  },
  secondaryBtnText: { color: "#555", fontWeight: "700", fontSize: 15 },
});
