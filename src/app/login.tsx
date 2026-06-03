import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    const identifier = email.trim();
    if (!identifier || !password) {
      setError("Please enter your email or username and password.");
      return;
    }
    setLoading(true);

    // Resolve username → email if no @ present
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

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });
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

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Logo */}
          <View style={styles.logoSection}>
            <View style={styles.logoMark}>
              <Text style={styles.logoMarkText}>AT</Text>
            </View>
            <Text style={styles.appName}>ArcadeTracker</Text>
            <Text style={styles.tagline}>Track every roll. Own every lane.</Text>
          </View>

          {/* Form */}
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

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <Pressable onPress={() => router.push("/signup")}>
              <Text style={styles.footerLink}>Create one</Text>
            </Pressable>
          </View>

          {/* Demo link */}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  flex: { flex: 1 },
  container: { flexGrow: 1, padding: 28, justifyContent: "center" },

  logoSection: { alignItems: "center", marginBottom: 48 },
  logoMark: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  logoMarkText: { color: "#000", fontSize: 22, fontWeight: "900", letterSpacing: -1 },
  appName: { color: "#fff", fontSize: 26, fontWeight: "900", letterSpacing: -0.5, marginBottom: 6 },
  tagline: { color: "#444", fontSize: 14 },

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
});
