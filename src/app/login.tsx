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
import { useAuth } from "../context/auth-context";
import { CURRENT_TOS_VERSION } from "./terms";

export default function LoginScreen() {
  const { setRememberMe } = useAuth();

  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [loading, setLoading]           = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [rememberMe, setRememberMeLocal] = useState(false);

  // ToS acceptance modal
  const [showTosModal, setShowTosModal]   = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [tosAgreed, setTosAgreed]         = useState(false);
  const [acceptingTos, setAcceptingTos]   = useState(false);

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

  function toggleRememberMe() {
    const next = !rememberMe;
    setRememberMeLocal(next);
    setRememberMe(next);
  }

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

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    if (authError) {
      setError("Incorrect email, username, or password.");
      setLoading(false);
      return;
    }

    // Check if user has accepted the current ToS version
    const userId = authData.user?.id;
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("tos_accepted_version")
        .eq("id", userId)
        .maybeSingle();

      if (profile?.tos_accepted_version !== CURRENT_TOS_VERSION) {
        // Must accept updated ToS before proceeding
        setPendingUserId(userId);
        setLoading(false);
        setShowTosModal(true);
        return;
      }
    }

    setLoading(false);
    completeLogin(authData.user?.id);
  }

  async function completeLogin(_userId?: string) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
      router.replace("/mfa-verify" as any);
    } else {
      router.replace("/");
    }
  }

  async function handleAcceptTos() {
    if (!tosAgreed || !pendingUserId) return;
    setAcceptingTos(true);
    await supabase.rpc("rpc_accept_tos", { p_version: CURRENT_TOS_VERSION });
    setAcceptingTos(false);
    setShowTosModal(false);
    completeLogin(pendingUserId);
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

            {/* Remember Me + Forgot links */}
            <View style={styles.optionsRow}>
              <Pressable style={styles.rememberRow} onPress={toggleRememberMe}>
                <View style={[styles.checkbox, rememberMe && styles.checkboxActive]}>
                  {rememberMe && <Ionicons name="checkmark" size={12} color="#000" />}
                </View>
                <Text style={styles.rememberLabel}>Remember me</Text>
              </Pressable>
              <View style={styles.forgotLinks}>
                <Pressable onPress={() => setShowForgotUsername(true)}>
                  <Text style={styles.forgotLink}>Forgot username?</Text>
                </Pressable>
                <Pressable onPress={() => setShowForgotPassword(true)}>
                  <Text style={styles.forgotLink}>Forgot password?</Text>
                </Pressable>
              </View>
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

      {/* ── ToS Acceptance Modal ─────────────────────────────────── */}
      <Modal visible={showTosModal} transparent animationType="slide" onRequestClose={() => {}}>
        <View style={styles.modalBg}>
          <View style={[styles.sheet, { maxHeight: "85%" }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetIconRow}>
              <View style={[styles.sheetIcon, { backgroundColor: "rgba(6,182,212,0.08)" }]}>
                <Ionicons name="document-text-outline" size={22} color="#06b6d4" />
              </View>
            </View>
            <Text style={styles.sheetTitle}>Updated Terms of Service</Text>
            <Text style={styles.sheetSub}>
              We've updated our Terms of Service. Please review and accept to continue.
            </Text>
            <ScrollView style={styles.tosScroll} showsVerticalScrollIndicator>
              <Text style={styles.tosPreviewText}>
                {[
                  "ArcadeTracker is a 21+ platform. By using this app you confirm you are 21 or older.",
                  "",
                  "CONTENT STANDARDS: You may not post nudity, sexually explicit content, profanity, racist content, homophobic or transphobic content, hate speech, gore, blood, or violent images on any public area of the app.",
                  "",
                  "PRIVATE MESSAGES: Direct messages are end-to-end encrypted. We cannot read them, but prohibited content is still against these Terms.",
                  "",
                  "ENFORCEMENT: Violations may result in temporary suspension (24 hours to 30 days) or permanent account deletion depending on severity.",
                  "",
                  "SCORE INTEGRITY: All submitted scores are subject to admin review. Falsified scores result in removal and potential ban.",
                  "",
                  "By accepting, you agree to the full Terms of Service (version 2026-06) and confirm you are 21 years of age or older.",
                ].join("\n")}
              </Text>
            </ScrollView>

            <Pressable
              style={styles.checkRow}
              onPress={() => setTosAgreed(!tosAgreed)}
            >
              <View style={[styles.checkbox, tosAgreed && styles.checkboxActive]}>
                {tosAgreed && <Ionicons name="checkmark" size={12} color="#000" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.checkLabel}>
                  I am 21 or older and agree to the{" "}
                  <Text
                    style={{ color: "#06b6d4", fontWeight: "700" }}
                    onPress={() => router.push("/terms" as any)}
                  >
                    Terms of Service
                  </Text>
                </Text>
              </View>
            </Pressable>

            <Pressable
              style={[styles.sheetBtn, (!tosAgreed || acceptingTos) && styles.sheetBtnDisabled]}
              onPress={handleAcceptTos}
              disabled={!tosAgreed || acceptingTos}
            >
              {acceptingTos
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={styles.sheetBtnText}>Accept and Continue</Text>
              }
            </Pressable>

            <Pressable
              style={styles.sheetCancel}
              onPress={() => {
                setShowTosModal(false);
                supabase.auth.signOut().catch(() => {});
              }}
            >
              <Text style={styles.sheetCancelText}>Decline and Sign Out</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

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

  optionsRow: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", marginBottom: 16, marginTop: -4,
  },
  rememberRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkbox: {
    width: 18, height: 18, borderRadius: 4,
    borderWidth: 1.5, borderColor: "#333",
    alignItems: "center", justifyContent: "center",
  },
  checkboxActive: { backgroundColor: "#06b6d4", borderColor: "#06b6d4" },
  rememberLabel: { color: "#555", fontSize: 13, fontWeight: "600" },
  forgotLinks: { gap: 6 },
  forgotLink: { color: "#06b6d4", fontSize: 12, fontWeight: "700", textAlign: "right" },

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
  modalBg:      { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "flex-end" },
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

  tosScroll: { maxHeight: 220, backgroundColor: "#0a0a0a", borderRadius: 12, padding: 14 },
  tosPreviewText: { color: "#666", fontSize: 13, lineHeight: 20 },

  checkRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: "#0a0a0a", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  checkLabel: { color: "#aaa", fontSize: 13, lineHeight: 20 },

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
