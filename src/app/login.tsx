import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getEmailRedirectTo } from "../../lib/auth-redirect";
import { supabase } from "../../lib/supabase";

export default function LoginScreen() {
  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [loading, setLoading]           = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // Forgot username sheet
  const [showForgotUsername, setShowForgotUsername]   = useState(false);
  const [forgotEmail, setForgotEmail]                 = useState("");
  const [lookingUpUsername, setLookingUpUsername]     = useState(false);
  const [foundUsername, setFoundUsername]             = useState<string | null>(null);
  const [forgotUsernameError, setForgotUsernameError] = useState<string | null>(null);

  // Forgot password sheet
  const [showForgotPassword, setShowForgotPassword]   = useState(false);
  const [resetEmail, setResetEmail]                   = useState("");
  const [sendingReset, setSendingReset]               = useState(false);
  const [resetSent, setResetSent]                     = useState(false);
  const [forgotPasswordError, setForgotPasswordError] = useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    const identifier = email.trim();
    if (!identifier || !password) {
      setError("Please enter your email or username and password.");
      return;
    }
    setLoading(true);

    let loginEmail = identifier;
    if (!identifier.includes("@")) {
      const { data: resolved } = await supabase.rpc("get_email_by_username", { p_username: identifier });
      if (!resolved) {
        setError("No account found with that username.");
        setLoading(false);
        return;
      }
      loginEmail = resolved;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    setLoading(false);
    if (authError) {
      setError("Incorrect email, username, or password.");
      return;
    }
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
      router.replace("/mfa-verify" as any);
    } else {
      router.replace("/");
    }
  }

  async function handleLookupUsername() {
    setForgotUsernameError(null);
    setFoundUsername(null);
    if (!forgotEmail.trim()) { setForgotUsernameError("Enter your email address."); return; }
    setLookingUpUsername(true);
    const { data } = await supabase.rpc("get_username_by_email", { p_email: forgotEmail.trim() });
    setLookingUpUsername(false);
    if (!data) {
      setForgotUsernameError("No account found with that email address.");
    } else {
      setFoundUsername(data);
    }
  }

  async function handleSendReset() {
    setForgotPasswordError(null);
    if (!resetEmail.trim()) { setForgotPasswordError("Enter your email address."); return; }
    setSendingReset(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      resetEmail.trim(),
      { redirectTo: getEmailRedirectTo("reset-password") }
    );
    setSendingReset(false);
    if (resetError) {
      setForgotPasswordError(resetError.message);
    } else {
      setResetSent(true);
    }
  }

  function closeForgotUsername() {
    setShowForgotUsername(false);
    setForgotEmail("");
    setFoundUsername(null);
    setForgotUsernameError(null);
  }

  function closeForgotPassword() {
    setShowForgotPassword(false);
    setResetEmail("");
    setResetSent(false);
    setForgotPasswordError(null);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <View style={styles.logoSection}>
            <View style={styles.logoMark}>
              <Text style={styles.logoMarkText}>AT</Text>
            </View>
            <Text style={styles.appName}>ArcadeTracker</Text>
            <Text style={styles.tagline}>Track every roll. Own every lane.</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.formTitle}>Welcome back</Text>

            <View style={styles.inputWrap}>
              <Ionicons name="person-outline" size={18} color="#444" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Email or username"
                placeholderTextColor="#333"
                autoCapitalize="none"
                keyboardType="default"
                autoComplete="username"
                returnKeyType="next"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={18} color="#444" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#333"
                secureTextEntry={!showPassword}
                autoComplete="current-password"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                value={password}
                onChangeText={setPassword}
              />
              <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color="#444" />
              </Pressable>
            </View>

            {/* Forgot links */}
            <View style={styles.forgotRow}>
              <Pressable onPress={() => setShowForgotUsername(true)}>
                <Text style={styles.forgotLink}>Forgot username?</Text>
              </Pressable>
              <Pressable onPress={() => setShowForgotPassword(true)}>
                <Text style={styles.forgotLink}>Forgot password?</Text>
              </Pressable>
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.submitBtn, loading && styles.submitBtnLoading]}
              onPress={handleLogin}
              disabled={loading}
            >
              <Text style={styles.submitBtnText}>{loading ? "Signing in…" : "Sign In"}</Text>
              {!loading && <Ionicons name="arrow-forward" size={18} color="#000" />}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <Pressable onPress={() => router.push("/signup")}>
              <Text style={styles.footerLink}>Create one</Text>
            </Pressable>
          </View>

          <Pressable style={styles.demoBtn} onPress={() => router.push("/demo" as any)}>
            <Ionicons name="eye-outline" size={15} color="#555" />
            <Text style={styles.demoBtnText}>Preview app without an account</Text>
          </Pressable>

          <Pressable style={styles.backBtn} onPress={() => router.replace("/auth" as any)}>
            <Ionicons name="arrow-back-outline" size={14} color="#333" />
            <Text style={styles.backBtnText}>Back</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Forgot Username Sheet ─────────────────────────────────── */}
      <Modal visible={showForgotUsername} transparent animationType="slide" onRequestClose={closeForgotUsername}>
        <View style={styles.modalBg}>
          <Pressable style={styles.modalDismiss} onPress={closeForgotUsername} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetIconRow}>
              <View style={styles.sheetIcon}>
                <Ionicons name="person-outline" size={22} color="#06b6d4" />
              </View>
            </View>
            <Text style={styles.sheetTitle}>Forgot username?</Text>
            <Text style={styles.sheetSub}>Enter the email address on your account and we'll look it up.</Text>

            {!foundUsername ? (
              <>
                <View style={styles.inputWrap}>
                  <Ionicons name="mail-outline" size={18} color="#444" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Email address"
                    placeholderTextColor="#333"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={forgotEmail}
                    onChangeText={setForgotEmail}
                    onSubmitEditing={handleLookupUsername}
                  />
                </View>

                {forgotUsernameError && (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
                    <Text style={styles.errorText}>{forgotUsernameError}</Text>
                  </View>
                )}

                <Pressable
                  style={[styles.sheetBtn, lookingUpUsername && styles.sheetBtnDisabled]}
                  onPress={handleLookupUsername}
                  disabled={lookingUpUsername}
                >
                  {lookingUpUsername
                    ? <ActivityIndicator color="#000" size="small" />
                    : <Text style={styles.sheetBtnText}>Look up username</Text>
                  }
                </Pressable>
              </>
            ) : (
              <View style={styles.resultBox}>
                <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultLabel}>Your username is</Text>
                  <Text style={styles.resultValue}>@{foundUsername}</Text>
                </View>
              </View>
            )}

            <Pressable style={styles.sheetCancel} onPress={closeForgotUsername}>
              <Text style={styles.sheetCancelText}>{foundUsername ? "Done" : "Cancel"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Forgot Password Sheet ─────────────────────────────────── */}
      <Modal visible={showForgotPassword} transparent animationType="slide" onRequestClose={closeForgotPassword}>
        <View style={styles.modalBg}>
          <Pressable style={styles.modalDismiss} onPress={closeForgotPassword} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetIconRow}>
              <View style={styles.sheetIcon}>
                <Ionicons name="lock-open-outline" size={22} color="#06b6d4" />
              </View>
            </View>
            <Text style={styles.sheetTitle}>Forgot password?</Text>

            {!resetSent ? (
              <>
                <Text style={styles.sheetSub}>Enter your email and we'll send you a link to reset your password.</Text>

                <View style={styles.inputWrap}>
                  <Ionicons name="mail-outline" size={18} color="#444" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Email address"
                    placeholderTextColor="#333"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={resetEmail}
                    onChangeText={setResetEmail}
                    onSubmitEditing={handleSendReset}
                  />
                </View>

                {forgotPasswordError && (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
                    <Text style={styles.errorText}>{forgotPasswordError}</Text>
                  </View>
                )}

                <Pressable
                  style={[styles.sheetBtn, sendingReset && styles.sheetBtnDisabled]}
                  onPress={handleSendReset}
                  disabled={sendingReset}
                >
                  {sendingReset
                    ? <ActivityIndicator color="#000" size="small" />
                    : <Text style={styles.sheetBtnText}>Send reset link</Text>
                  }
                </Pressable>
              </>
            ) : (
              <View style={styles.resultBox}>
                <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
                <Text style={[styles.resultLabel, { flex: 1 }]}>
                  Reset link sent to <Text style={{ color: "#fff", fontWeight: "700" }}>{resetEmail}</Text>. Check your inbox.
                </Text>
              </View>
            )}

            <Pressable style={styles.sheetCancel} onPress={closeForgotPassword}>
              <Text style={styles.sheetCancelText}>{resetSent ? "Done" : "Cancel"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: "#000" },
  flex:      { flex: 1 },
  container: { flexGrow: 1, padding: 28, justifyContent: "center" },

  logoSection: { alignItems: "center", marginBottom: 48 },
  logoMark: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  logoMarkText: { color: "#000", fontSize: 22, fontWeight: "900", letterSpacing: -1 },
  appName:  { color: "#fff", fontSize: 26, fontWeight: "900", letterSpacing: -0.5, marginBottom: 6 },
  tagline:  { color: "#444", fontSize: 14 },

  form: { backgroundColor: "#111", borderRadius: 24, padding: 24, borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 24 },
  formTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 20 },

  inputWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#0a0a0a", borderRadius: 14,
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 12,
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: "#fff", paddingVertical: 15, fontSize: 16 },
  eyeBtn: { padding: 4 },

  forgotRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16, marginTop: -4 },
  forgotLink: { color: "#06b6d4", fontSize: 13, fontWeight: "700" },

  submitBtn: {
    backgroundColor: "#06b6d4", borderRadius: 14,
    paddingVertical: 16, marginTop: 8,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  submitBtnLoading: { backgroundColor: "#0891b2" },
  submitBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },

  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center" },
  footerText: { color: "#555", fontSize: 14 },
  footerLink: { color: "#06b6d4", fontSize: 14, fontWeight: "800" },

  demoBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, marginTop: 20, paddingVertical: 10,
  },
  demoBtnText: { color: "#555", fontSize: 13 },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 12,
    padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
  },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },

  backBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, marginTop: 12, paddingVertical: 8,
  },
  backBtnText: { color: "#333", fontSize: 13 },

  // Modal / sheet
  modalBg:      { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40,
    borderTopWidth: 1, borderColor: "#1e1e1e", gap: 12,
  },
  sheetHandle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center" },
  sheetIconRow: { alignItems: "center" },
  sheetIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: "rgba(6,182,212,0.08)", borderWidth: 1,
    borderColor: "rgba(6,182,212,0.2)", alignItems: "center", justifyContent: "center",
  },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "900", textAlign: "center" },
  sheetSub:   { color: "#555", fontSize: 14, textAlign: "center", lineHeight: 20 },

  sheetBtn: {
    backgroundColor: "#06b6d4", borderRadius: 14,
    paddingVertical: 16, alignItems: "center", justifyContent: "center",
  },
  sheetBtnDisabled: { backgroundColor: "#0a4a55", opacity: 0.6 },
  sheetBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },

  sheetCancel: { backgroundColor: "#0d0d0d", borderRadius: 14, padding: 14, alignItems: "center" },
  sheetCancelText: { color: "#555", fontWeight: "700", fontSize: 15 },

  resultBox: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(34,197,94,0.08)", borderRadius: 14,
    padding: 16, borderWidth: 1, borderColor: "rgba(34,197,94,0.2)",
  },
  resultLabel: { color: "#555", fontSize: 13 },
  resultValue: { color: "#22c55e", fontSize: 18, fontWeight: "900", marginTop: 2 },
});
