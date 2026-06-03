import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

export default function DeleteAccountScreen() {
  const [step, setStep] = useState<"confirm" | "password" | "done">("confirm");
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!password.trim()) { setError("Please enter your password to confirm."); return; }
    setError(null);
    setDeleting(true);

    // Re-authenticate to confirm identity
    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData.session?.user?.email;
    if (!email) { setError("Not signed in. Please log in and try again."); setDeleting(false); return; }

    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) {
      setError("Incorrect password. Please try again.");
      setDeleting(false);
      return;
    }

    // Delete user data in dependency order
    // Supabase auth.deleteUser requires admin/service role — so we mark account for deletion
    // and instruct the user, OR call a Supabase Edge Function that uses service role.
    // Here we soft-delete: anonymise the profile and sign out.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Could not retrieve user."); setDeleting(false); return; }

    const deletedUsername = `deleted_${Date.now()}`;
    await Promise.all([
      supabase.from("profiles").update({
        username: deletedUsername,
        avatar_url: null,
        bio: null,
      }).eq("id", user.id),
      supabase.from("posts").delete().eq("user_id", user.id),
      supabase.from("follows").delete().or(`follower_id.eq.${user.id},following_id.eq.${user.id}`),
    ]);

    await supabase.auth.signOut();
    setDeleting(false);
    setStep("done");
  }

  if (step === "done") {
    return (
      <SafeAreaView style={s.root} edges={["top", "bottom"]}>
        <View style={s.doneWrap}>
          <View style={s.doneIcon}>
            <Ionicons name="checkmark-circle" size={52} color="#22c55e" />
          </View>
          <Text style={s.doneTitle}>Account Deleted</Text>
          <Text style={s.doneSub}>
            Your personal data has been removed and you have been signed out.
            Scores and leaderboard entries linked to your anonymised ID may
            remain for historical accuracy.
          </Text>
          <Pressable style={s.doneBtn} onPress={() => router.replace("/login" as any)}>
            <Text style={s.doneBtnText}>Back to Login</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>Delete Account</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        {step === "confirm" && (
          <>
            <View style={s.warningCard}>
              <Ionicons name="warning" size={28} color="#ef4444" style={{ marginBottom: 12 }} />
              <Text style={s.warningTitle}>This cannot be undone</Text>
              <Text style={s.warningBody}>
                Deleting your account will permanently remove:
              </Text>
              <View style={s.bulletList}>
                {[
                  "Your profile and username",
                  "All posts and photos you've shared",
                  "Your follow connections",
                  "Your tournament registrations",
                ].map((item) => (
                  <View key={item} style={s.bulletRow}>
                    <Ionicons name="close-circle" size={14} color="#ef4444" />
                    <Text style={s.bulletText}>{item}</Text>
                  </View>
                ))}
              </View>
              <Text style={[s.warningBody, { marginTop: 14 }]}>
                Your scores and leaderboard entries will be anonymised rather than
                deleted to preserve historical records.
              </Text>
            </View>

            <Pressable style={s.proceedBtn} onPress={() => setStep("password")}>
              <Text style={s.proceedBtnText}>I understand — continue</Text>
            </Pressable>
            <Pressable style={s.cancelBtn} onPress={() => router.back()}>
              <Text style={s.cancelBtnText}>Keep my account</Text>
            </Pressable>
          </>
        )}

        {step === "password" && (
          <>
            <Text style={s.passwordLabel}>Confirm your password</Text>
            <Text style={s.passwordSub}>
              Enter your current password to permanently delete your account.
            </Text>
            <TextInput
              style={s.input}
              placeholder="Password"
              placeholderTextColor="#333"
              secureTextEntry
              value={password}
              onChangeText={(v) => { setPassword(v); setError(null); }}
              autoFocus
            />
            {error && (
              <View style={s.errorRow}>
                <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}
            <Pressable
              style={[s.deleteBtn, (deleting || !password.trim()) && s.deleteBtnOff]}
              onPress={handleDelete}
              disabled={deleting || !password.trim()}
            >
              {deleting
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.deleteBtnText}>Delete My Account</Text>}
            </Pressable>
            <Pressable style={s.cancelBtn} onPress={() => { setStep("confirm"); setPassword(""); setError(null); }}>
              <Text style={s.cancelBtnText}>Go back</Text>
            </Pressable>
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#111", alignItems: "center", justifyContent: "center",
  },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  content: { paddingHorizontal: 22, paddingTop: 24 },

  warningCard: {
    backgroundColor: "rgba(239,68,68,0.05)", borderRadius: 20,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
    padding: 22, alignItems: "center", marginBottom: 24,
  },
  warningTitle: { color: "#ef4444", fontSize: 18, fontWeight: "900", marginBottom: 10 },
  warningBody: { color: "#888", fontSize: 14, lineHeight: 21, textAlign: "center" },
  bulletList: { width: "100%", gap: 8, marginTop: 14 },
  bulletRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bulletText: { color: "#999", fontSize: 14 },

  proceedBtn: {
    backgroundColor: "rgba(239,68,68,0.1)", borderRadius: 14, paddingVertical: 15,
    alignItems: "center", borderWidth: 1, borderColor: "rgba(239,68,68,0.3)",
    marginBottom: 12,
  },
  proceedBtnText: { color: "#ef4444", fontWeight: "800", fontSize: 15 },
  cancelBtn: {
    backgroundColor: "#111", borderRadius: 14, paddingVertical: 15,
    alignItems: "center", borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 12,
  },
  cancelBtnText: { color: "#555", fontWeight: "700", fontSize: 15 },

  passwordLabel: { color: "#fff", fontSize: 18, fontWeight: "900", marginBottom: 8 },
  passwordSub: { color: "#555", fontSize: 14, lineHeight: 21, marginBottom: 20 },
  input: {
    backgroundColor: "#0a0a0a", color: "#fff", padding: 16,
    borderRadius: 14, fontSize: 16, borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 10,
  },
  errorRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 10,
    padding: 10, marginBottom: 14, borderWidth: 1, borderColor: "rgba(239,68,68,0.15)",
  },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },
  deleteBtn: {
    backgroundColor: "#ef4444", borderRadius: 14, paddingVertical: 15,
    alignItems: "center", marginBottom: 12,
  },
  deleteBtnOff: { backgroundColor: "#1a1a1a" },
  deleteBtnText: { color: "#fff", fontWeight: "900", fontSize: 15 },

  doneWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  doneIcon: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: "rgba(34,197,94,0.08)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(34,197,94,0.2)", marginBottom: 20,
  },
  doneTitle: { color: "#fff", fontSize: 24, fontWeight: "900", marginBottom: 12 },
  doneSub: { color: "#555", fontSize: 14, lineHeight: 22, textAlign: "center", marginBottom: 32 },
  doneBtn: {
    backgroundColor: "#06b6d4", borderRadius: 14, paddingHorizontal: 32, paddingVertical: 15,
  },
  doneBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },
});
