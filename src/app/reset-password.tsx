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
import { supabase } from "../../lib/supabase";

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
    // Supabase fires PASSWORD_RECOVERY when the reset link is clicked
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    // Also check if already in a recovery session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleReset() {
    setError(null);
    if (!password || !confirm) { setError("Fill in both fields."); return; }
    if (password.length < 6)   { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm)  { setError("Passwords don't match."); return; }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
    } else {
      setDone(true);
    }
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
              placeholderTextColor="#333"
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
              placeholderTextColor="#333"
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
  sub:   { color: "#555", fontSize: 14, textAlign: "center", lineHeight: 20 },

  inputWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#0a0a0a", borderRadius: 14,
    borderWidth: 1, borderColor: "#1e1e1e",
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
  successSub:   { color: "#555", fontSize: 14, textAlign: "center", lineHeight: 20 },
  doneBtn: {
    backgroundColor: "#06b6d4", borderRadius: 14,
    paddingHorizontal: 48, paddingVertical: 16, marginTop: 8,
  },
  doneBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
  waitText: { color: "#555", fontSize: 14, marginTop: 12 },
});
