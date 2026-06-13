import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { reportError } from "../lib/report-error";
import { supabase } from "../../lib/supabase";
import { sendSecurityAlert } from "../../lib/security-notify";
import { validatePasswordStrength } from "../../lib/validation";

import { API_BASE } from "../../lib/api-base";

export default function ResetPasswordScreen() {
  const [ready, setReady]               = useState(false);
  const [password, setPassword]         = useState("");
  const [confirm, setConfirm]           = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [done, setDone]                 = useState(false);

  useEffect(() => {
    // The Supabase client (detectSessionInUrl: true) auto-exchanges the ?code=
    // param on load. We just listen for the result — no manual exchange needed.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    // Fallback: client already exchanged the code before listener was set up
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleReset() {
    setError(null);
    if (!password || !confirm) { setError("Fill in both fields."); return; }
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.ok)   { setError("Password must be at least 12 characters and include upper/lowercase letters and a number."); return; }
    if (password !== confirm)  { setError("Passwords don't match."); return; }

    setLoading(true);
    try {
      // Try the direct Supabase client path first — works for most accounts.
      const { error: directErr } = await supabase.auth.updateUser({ password });
      if (!directErr) {
        sendSecurityAlert("password_changed");
        setDone(true);
        setLoading(false);
        return;
      }

      // AAL2 accounts (MFA enrolled) need a server-side admin update.
      if (!directErr.message.toLowerCase().includes("aal2")) {
        reportError("ResetPassword.handleReset", directErr.message);
        setError(directErr.message);
        setLoading(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${API_BASE}/api/password-reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ password }),
      });
      const text = await resp.text();
      let result: Record<string, string> = {};
      try { result = JSON.parse(text); } catch { /* non-JSON error body */ }
      if (!resp.ok || result.error) {
        const msg = result.error ?? `Failed to update password (${resp.status}).`;
        reportError("ResetPassword.handleReset", msg);
        setError(msg);
      } else {
        sendSecurityAlert("password_changed");
        setDone(true);
      }
    } catch {
      reportError("ResetPassword.handleReset", "Network error — please try again.");
      setError("Network error — please try again.");
    }
    setLoading(false);
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={48} color="#22c55e" />
          </View>
          <Text style={styles.successTitle}>Password updated</Text>
          <Text style={styles.successSub}>Your password has been changed. You can now sign in.</Text>
          <Pressable style={styles.doneBtn} onPress={() => router.replace("/login")}>
            <Text style={styles.doneBtnText}>Go to Sign In</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!ready) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color="#06b6d4" size="large" />
          <Text style={styles.waitText}>Verifying reset link…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.container}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed-outline" size={32} color="#06b6d4" />
          </View>
          <Text style={styles.title}>Set new password</Text>
          <Text style={styles.sub}>Choose a strong password for your account.</Text>

          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color="#444" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="New password"
              placeholderTextColor="#555"
              secureTextEntry={!showPassword}
              autoComplete="new-password"
              value={password}
              onChangeText={setPassword}
            />
            <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
              <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color="#444" />
            </Pressable>
          </View>

          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color="#444" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Confirm new password"
              placeholderTextColor="#555"
              secureTextEntry={!showConfirm}
              autoComplete="new-password"
              returnKeyType="done"
              onSubmitEditing={handleReset}
              value={confirm}
              onChangeText={setConfirm}
            />
            <Pressable onPress={() => setShowConfirm(!showConfirm)} style={styles.eyeBtn}>
              <Ionicons name={showConfirm ? "eye-off-outline" : "eye-outline"} size={18} color="#444" />
            </Pressable>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
            onPress={handleReset}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={styles.submitBtnText}>Update Password</Text>
            }
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#000" },
  flex:   { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },
  container: { flex: 1, padding: 28, justifyContent: "center", gap: 14 },

  iconWrap: {
    width: 72, height: 72, borderRadius: 36, alignSelf: "center",
    backgroundColor: "rgba(6,182,212,0.1)", borderWidth: 1,
    borderColor: "rgba(6,182,212,0.25)", alignItems: "center", justifyContent: "center",
    marginBottom: 8,
  },
  title: { color: "#fff", fontSize: 24, fontWeight: "900", textAlign: "center" },
  sub:   { color: "#8a8a8a", fontSize: 14, textAlign: "center", lineHeight: 20 },

  inputWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#0a0a0a", borderRadius: 14,
    borderWidth: 1, borderColor: "#1a1a1a",
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: "#fff", paddingVertical: 15, fontSize: 16 },
  eyeBtn: { padding: 4 },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 12,
    padding: 12, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
  },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },

  submitBtn: {
    backgroundColor: "#06b6d4", borderRadius: 14,
    paddingVertical: 16, alignItems: "center", justifyContent: "center",
  },
  submitBtnDisabled: { backgroundColor: "#0a4a55", opacity: 0.6 },
  submitBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },

  successIcon: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: "rgba(34,197,94,0.1)", borderWidth: 1,
    borderColor: "rgba(34,197,94,0.25)", alignItems: "center", justifyContent: "center",
  },
  successTitle: { color: "#22c55e", fontSize: 24, fontWeight: "900" },
  successSub:   { color: "#8a8a8a", fontSize: 14, textAlign: "center", lineHeight: 20 },
  doneBtn: {
    backgroundColor: "#06b6d4", borderRadius: 14,
    paddingHorizontal: 48, paddingVertical: 16, marginTop: 8,
  },
  doneBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
  waitText: { color: "#8a8a8a", fontSize: 14, marginTop: 12 },
});
