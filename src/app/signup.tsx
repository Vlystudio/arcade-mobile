import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
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

function generateSuggestions(base: string): string[] {
  const clean = base.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 16);
  const year = new Date().getFullYear();
  const r = () => Math.floor(Math.random() * 900 + 100);
  return [
    `${clean}${r()}`,
    `${clean}_${r()}`,
    `${clean}${year}`,
    `the_${clean}`,
  ];
}

export default function SignupScreen() {
  const [username, setUsername]                 = useState("");
  const [email, setEmail]                       = useState("");
  const [password, setPassword]                 = useState("");
  const [confirmPassword, setConfirmPassword]   = useState("");
  const [loading, setLoading]                   = useState(false);
  const [showPassword, setShowPassword]         = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError]                       = useState<string | null>(null);

  const [suggestions, setSuggestions]           = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions]   = useState(false);

  async function handleSignup() {
    setError(null);
    const uname = username.trim();

    if (!uname || !email.trim() || !password || !confirmPassword) {
      setError("Fill in all fields to continue.");
      return;
    }
    if (uname.length < 3 || uname.length > 20) {
      setError("Username must be 3–20 characters.");
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(uname)) {
      setError("Username can only contain letters, numbers, and underscores.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);

    // Check if username is already taken (via SECURITY DEFINER RPC to bypass RLS)
    const { data: available } = await supabase.rpc("check_username_available", { p_username: uname });
    if (available === false) {
      setSuggestions(generateSuggestions(uname));
      setShowSuggestions(true);
      setLoading(false);
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { username: uname },
        emailRedirectTo: getEmailRedirectTo(),
      },
    });

    if (signUpError) {
      setLoading(false);
      setError(signUpError.message);
      return;
    }

    if (data.user) {
      const { error: profileError } = await supabase.from("profiles").upsert({
        id: data.user.id,
        username: uname,
        email: email.trim(),
      });
      if (profileError?.code === "23505") {
        // Username was taken between check and insert (race condition)
        setLoading(false);
        setSuggestions(generateSuggestions(uname));
        setShowSuggestions(true);
        return;
      }
    }

    setLoading(false);
    router.replace("/auth" as any);
  }

  function pickSuggestion(s: string) {
    setUsername(s);
    setShowSuggestions(false);
    setError(null);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoSection}>
            <View style={styles.logoMark}>
              <Text style={styles.logoMarkText}>AT</Text>
            </View>
            <Text style={styles.appName}>ArcadeTracker</Text>
            <Text style={styles.tagline}>Join the league. Track your game.</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.formTitle}>Create account</Text>
            <Text style={styles.formSub}>Start tracking your scores today</Text>

            <View style={styles.inputWrap}>
              <Ionicons name="person-outline" size={18} color="#444" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Username"
                placeholderTextColor="#333"
                autoCapitalize="none"
                autoComplete="username-new"
                returnKeyType="next"
                value={username}
                onChangeText={setUsername}
              />
            </View>

            <View style={styles.inputWrap}>
              <Ionicons name="mail-outline" size={18} color="#444" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Email address"
                placeholderTextColor="#333"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={18} color="#444" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Password (min. 6 characters)"
                placeholderTextColor="#333"
                secureTextEntry={!showPassword}
                autoComplete="new-password"
                returnKeyType="next"
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
                placeholder="Confirm password"
                placeholderTextColor="#333"
                secureTextEntry={!showConfirmPassword}
                autoComplete="new-password"
                returnKeyType="done"
                onSubmitEditing={handleSignup}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <Pressable onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeBtn}>
                <Ionicons name={showConfirmPassword ? "eye-off-outline" : "eye-outline"} size={18} color="#444" />
              </Pressable>
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.submitBtn, loading && styles.submitBtnLoading, pressed && { opacity: 0.85 }]}
              onPress={handleSignup}
              disabled={loading}
            >
              <Text style={styles.submitBtnText}>{loading ? "Creating account…" : "Create Account"}</Text>
              {!loading && <Ionicons name="arrow-forward" size={18} color="#000" />}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Pressable onPress={() => router.push("/login")}>
              <Text style={styles.footerLink}>Sign in</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Username taken modal */}
      <Modal
        visible={showSuggestions}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSuggestions(false)}
      >
        <View style={styles.modalBg}>
          <Pressable style={styles.modalDismiss} onPress={() => setShowSuggestions(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetIconRow}>
              <View style={styles.sheetIcon}>
                <Ionicons name="person-remove-outline" size={22} color="#ef4444" />
              </View>
            </View>

            <Text style={styles.sheetTitle}>Username taken</Text>
            <Text style={styles.sheetSub}>
              <Text style={styles.sheetSubBold}>@{username.trim()}</Text> is already in use.{"\n"}
              Pick one of these available alternatives:
            </Text>

            <View style={styles.suggestionList}>
              {suggestions.map((s) => (
                <Pressable
                  key={s}
                  style={({ pressed }) => [styles.suggestionChip, pressed && styles.suggestionChipPressed]}
                  onPress={() => pickSuggestion(s)}
                >
                  <Text style={styles.suggestionAt}>@</Text>
                  <Text style={styles.suggestionName}>{s}</Text>
                  <Ionicons name="arrow-forward-outline" size={14} color="#06b6d4" />
                </Pressable>
              ))}
            </View>

            <Pressable style={styles.sheetInputRow} onPress={() => setShowSuggestions(false)}>
              <Ionicons name="pencil-outline" size={15} color="#555" />
              <Text style={styles.sheetInputText}>Type my own username instead</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#000" },
  flex:   { flex: 1 },
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
  formTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  formSub:   { color: "#555", fontSize: 14, marginBottom: 20 },

  inputWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#0a0a0a", borderRadius: 14,
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 12,
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: "#fff", paddingVertical: 15, fontSize: 16 },
  eyeBtn: { padding: 4 },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 12,
    padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
  },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },

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

  // Modal / bottom sheet
  modalBg:      { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40,
    borderTopWidth: 1, borderColor: "#1e1e1e",
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 20 },

  sheetIconRow: { alignItems: "center", marginBottom: 14 },
  sheetIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: "rgba(239,68,68,0.08)", borderWidth: 1,
    borderColor: "rgba(239,68,68,0.2)", alignItems: "center", justifyContent: "center",
  },

  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "900", textAlign: "center", marginBottom: 8 },
  sheetSub:   { color: "#555", fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 24 },
  sheetSubBold: { color: "#888", fontWeight: "800" },

  suggestionList: { gap: 10, marginBottom: 20 },
  suggestionChip: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#0d0d0d", borderRadius: 16,
    paddingHorizontal: 18, paddingVertical: 16,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  suggestionChipPressed: { borderColor: "#06b6d4", backgroundColor: "rgba(6,182,212,0.05)" },
  suggestionAt:   { color: "#444", fontSize: 16, fontWeight: "700" },
  suggestionName: { flex: 1, color: "#fff", fontSize: 16, fontWeight: "800" },

  sheetInputRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 10,
  },
  sheetInputText: { color: "#555", fontSize: 13 },
});
