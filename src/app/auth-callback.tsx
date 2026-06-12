import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
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

export default function AuthCallbackScreen() {
  const [status, setStatus] = useState<"loading" | "error">("loading");

  useEffect(() => {
    // The Supabase client auto-exchanges ?code= on load — just listen for result.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) router.replace("/");
    });

    // Fallback: session already active before listener was set up
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace("/");
    });

    const timeout = setTimeout(() => setStatus("error"), 8000);

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  if (status === "error") {
    return (
      <SafeAreaView style={s.root}>
        <View style={s.center}>
          <View style={s.errorIcon}>
            <Ionicons name="alert-circle" size={44} color="#ef4444" />
          </View>
          <Text style={s.errorTitle}>Link expired</Text>
          <Text style={s.errorSub}>
            This verification link has expired or is invalid.{"\n"}
            Request a new one from the sign-up page.
          </Text>
          <Pressable style={s.btn} onPress={() => router.replace("/signup" as any)}>
            <Text style={s.btnText}>Back to Sign Up</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <View style={s.center}>
        <ActivityIndicator color="#06b6d4" size="large" />
        <Text style={s.loadText}>Verifying your account…</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },

  loadText: { color: "#8a8a8a", fontSize: 14, marginTop: 8 },

  errorIcon: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: "rgba(239,68,68,0.08)", borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)", alignItems: "center", justifyContent: "center",
  },
  errorTitle: { color: "#ef4444", fontSize: 22, fontWeight: "900" },
  errorSub:   { color: "#8a8a8a", fontSize: 14, textAlign: "center", lineHeight: 20 },
  btn: {
    backgroundColor: "#06b6d4", borderRadius: 14,
    paddingHorizontal: 48, paddingVertical: 16, marginTop: 8,
  },
  btnText: { color: "#000", fontWeight: "900", fontSize: 16 },
});
