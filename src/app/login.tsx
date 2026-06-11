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
import { reportError } from "../lib/report-error";
import { BugReportBanner } from "../components/bug-report";
import { CURRENT_TOS_VERSION } from "./terms";

const TOS_SECTIONS = [
  { title: "1. Agreement to Terms", body: "By downloading, installing, or using ArcadeTracker you agree to be bound by these Terms of Service and all applicable laws. If you do not agree to all of these terms, do not use the App." },
  { title: "2. Age Requirement", body: "ArcadeTracker is intended for users aged 21 and older. You must be at least 21 years of age to create an account or use the App. By creating an account you represent and warrant that you are 21 years of age or older.\n\nIf we discover that an account was created by someone under 21, the account will be immediately and permanently deleted without notice." },
  { title: "3. Your Account", body: "• You are solely responsible for maintaining the confidentiality of your login credentials and for all activity that occurs under your account.\n• Do not share your account with any other person.\n• You must notify us immediately if you suspect any unauthorized use of your account.\n• You may not create more than one account. Duplicate accounts will be terminated.\n• Impersonating another user, staff member, or venue employee is strictly prohibited." },
  { title: "4. Community Standards", body: "All content you post publicly — including profile photos, bio text, posts, team names, score submissions, and messages visible to other users — must comply with the following standards.\n\nPROHIBITED CONTENT\n\n• Nudity, sexually explicit or suggestive content, or pornography of any kind.\n• Profanity, obscene language, or sexually explicit text directed at or visible to other users.\n• Racist, white-supremacist, antisemitic, or other hate-based content targeting any race, ethnicity, or national origin.\n• Homophobic, transphobic, or any content that demeans or dehumanizes individuals based on sexual orientation or gender identity.\n• Hate speech: any content that promotes violence or hatred against individuals or groups based on religion, disability, sex, or any other protected characteristic.\n• Gore, graphic violence, dismemberment, or images of serious injury or death.\n• Images of blood or violent photographs of any kind.\n• Harassment, threats, or targeted intimidation of any user or staff member.\n• Content that glorifies or promotes drug use, illegal firearms, or criminal activity.\n• Spam, phishing links, scam content, or unsolicited commercial promotions.\n• Content that violates any third party's intellectual property rights.\n\nContent moderation is performed by both automated systems and human review. Prohibited content will be removed without notice." },
  { title: "5. Private Messages", body: "ArcadeTracker's direct messaging feature uses end-to-end encryption. This means private messages between users are encrypted on your device before transmission and can only be decrypted by the intended recipient. ArcadeTracker staff cannot read the content of private messages.\n\nWhile we cannot monitor private messages, we strongly discourage the sharing of any prohibited content in private messages. Sharing such content through private messaging violates these Terms of Service and may result in account suspension if reported and verified." },
  { title: "6. User Content License", body: "You retain ownership of all content you create and post on ArcadeTracker. By posting content, you grant ArcadeTracker a non-exclusive, royalty-free, worldwide license to host, store, display, reproduce, and distribute that content solely for the purpose of operating and improving the App.\n\nThis license ends when you delete your content or your account. You are responsible for ensuring you have all necessary rights to any content you upload." },
  { title: "7. Score Integrity", body: "Scores submitted on ArcadeTracker are subject to review by venue staff and platform administrators. By submitting a score, you represent that:\n\n• The score was achieved legitimately by you on the indicated machine.\n• Any photo or video evidence submitted is authentic and unedited.\n• The score was not achieved through any exploit, cheat, or external assistance.\n\nScores found to be falsified or submitted with fabricated evidence will be removed. Repeated violations will result in account suspension or permanent ban. All administrative decisions regarding score integrity are final." },
  { title: "8. Enforcement & Account Suspension", body: "Violations of these Terms of Service are subject to enforcement action, which may include any of the following at our sole discretion:\n\n• A formal warning issued to your account.\n• Temporary suspension (ranging from 24 hours to 30 days depending on severity).\n• Permanent deletion of your account and all associated data.\n\nSevere violations — including posting child sexual abuse material (CSAM), issuing credible threats of violence, or engaging in targeted harassment campaigns — will result in immediate permanent account deletion and may be reported to law enforcement.\n\nWe reserve the right to suspend or terminate any account at our sole discretion for any violation of these terms, or for conduct that we determine to be harmful to our community." },
  { title: "9. Intellectual Property", body: "All rights, title, and interest in the ArcadeTracker platform — including its design, software, brand, logos, and features — are owned by or licensed to ArcadeTracker. These terms do not grant you any right to use our trademarks, logos, or brand features without prior written consent." },
  { title: "10. Disclaimer of Warranties", body: "THE APP IS PROVIDED \"AS IS\" AND \"AS AVAILABLE\" WITHOUT WARRANTIES OF ANY KIND. WE DISCLAIM ALL WARRANTIES INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE APP WILL BE UNINTERRUPTED OR ERROR-FREE." },
  { title: "11. Limitation of Liability", body: "TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, ARCADETRACKER SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE APP.\n\nIN NO EVENT SHALL OUR TOTAL LIABILITY TO YOU EXCEED THE GREATER OF $50 OR THE AMOUNT YOU PAID US IN THE PRECEDING 12 MONTHS." },
  { title: "12. Indemnification", body: "You agree to indemnify, defend, and hold harmless ArcadeTracker and its affiliates, officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, and expenses arising out of or in any way connected with your use of the App, your content, or your violation of these Terms." },
  { title: "13. Governing Law", body: "These Terms are governed by the laws of the state in which ArcadeTracker's principal place of business is located, without regard to its conflict of law provisions. Any disputes arising under these Terms shall be resolved in the courts of that jurisdiction." },
  { title: "14. Changes to These Terms", body: "We may update these Terms at any time. When we make material changes, we will notify you through the App and require you to affirmatively accept the updated Terms before continuing to use the service." },
  { title: "15. Contact Us", body: "Questions about these Terms of Service? Contact us at:\n\nsupport@arcadetracker.app\n\nOr use the Support Chat feature available from your Profile." },
];

export default function LoginScreen() {
  const { setRememberMe } = useAuth();

  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [loading, setLoading]           = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [rememberMe, setRememberMeLocal] = useState(false);

  // ToS acceptance modal
  const [showTosModal, setShowTosModal]     = useState(false);
  const [pendingUserId, setPendingUserId]   = useState<string | null>(null);
  const [tosScrolled, setTosScrolled]       = useState(false);
  const [acceptingTos, setAcceptingTos]     = useState(false);

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
        setTosScrolled(false);
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
    if (!tosScrolled || !pendingUserId) return;
    setAcceptingTos(true);
    await supabase.rpc("rpc_accept_tos", { p_version: CURRENT_TOS_VERSION });
    setAcceptingTos(false);
    setShowTosModal(false);
    completeLogin(pendingUserId);
  }

  function handleTosScroll(e: { nativeEvent: { layoutMeasurement: { height: number }; contentOffset: { y: number }; contentSize: { height: number } } }) {
    if (tosScrolled) return;
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 60) {
      setTosScrolled(true);
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
      reportError("Login.handleSendReset", resetError.message);
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
          </View>

          {/* Account benefit notice */}
          <View style={styles.noticeBanner}>
            <Ionicons name="game-controller-outline" size={18} color="#06b6d4" style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.noticeTitle}>Want to track your scores?</Text>
              <Text style={styles.noticeBody}>Create a free account to log high scores, join teams, enter tournaments, and appear on the leaderboard.</Text>
            </View>
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

            <BugReportBanner error={error} />

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

      {/* ── ToS Acceptance Modal (full-screen, scroll-to-unlock) ── */}
      <Modal visible={showTosModal} transparent={false} animationType="slide" onRequestClose={() => {}}>
        <SafeAreaView style={styles.tosModalRoot} edges={["top", "bottom"]}>
          {/* Header */}
          <View style={styles.tosModalHeader}>
            <View style={styles.tosModalIconWrap}>
              <Ionicons name="document-text-outline" size={20} color="#06b6d4" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tosModalTitle}>Terms of Service</Text>
              <Text style={styles.tosModalVersion}>Version {CURRENT_TOS_VERSION} — required to continue</Text>
            </View>
          </View>

          {/* Scroll hint */}
          {!tosScrolled && (
            <View style={styles.tosScrollHint}>
              <Ionicons name="arrow-down-circle-outline" size={15} color="#f59e0b" />
              <Text style={styles.tosScrollHintText}>Read all the way to the bottom to continue</Text>
            </View>
          )}

          {/* Full ToS text */}
          <ScrollView
            style={styles.tosModalScroll}
            contentContainerStyle={styles.tosModalScrollContent}
            showsVerticalScrollIndicator
            onScroll={handleTosScroll}
            scrollEventThrottle={100}
          >
            <Text style={styles.tosUpdated}>Last updated: June 2026 · Version {CURRENT_TOS_VERSION}</Text>

            {TOS_SECTIONS.map(({ title, body }) => (
              <View key={title} style={styles.tosSection}>
                <Text style={styles.tosSectionTitle}>{title}</Text>
                <Text style={styles.tosSectionBody}>{body}</Text>
              </View>
            ))}

            {/* Spacer so the last section isn't hidden behind the button bar */}
            <View style={{ height: 24 }} />
          </ScrollView>

          {/* Bottom action bar */}
          <View style={styles.tosModalFooter}>
            {tosScrolled ? (
              <Pressable
                style={[styles.tosAcceptBtn, acceptingTos && styles.tosAcceptBtnLoading]}
                onPress={handleAcceptTos}
                disabled={acceptingTos}
              >
                {acceptingTos
                  ? <ActivityIndicator color="#000" size="small" />
                  : <>
                      <Ionicons name="checkmark-circle-outline" size={20} color="#000" />
                      <Text style={styles.tosAcceptBtnText}>I agree — I am 21 or older</Text>
                    </>
                }
              </Pressable>
            ) : (
              <View style={styles.tosLockedBtn}>
                <Ionicons name="lock-closed-outline" size={16} color="#444" />
                <Text style={styles.tosLockedBtnText}>Scroll to read all terms</Text>
              </View>
            )}
            <Pressable
              style={styles.tosDeclineBtn}
              onPress={() => {
                setShowTosModal(false);
                setTosScrolled(false);
                supabase.auth.signOut().catch(() => {});
              }}
            >
              <Text style={styles.tosDeclineBtnText}>Decline and Sign Out</Text>
            </Pressable>
          </View>
        </SafeAreaView>
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

                <BugReportBanner error={forgotUsernameError} />

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

                <BugReportBanner error={forgotPasswordError} />

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

  // Full-screen ToS modal
  tosModalRoot: { flex: 1, backgroundColor: "#000" },
  tosModalHeader: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  tosModalIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(6,182,212,0.1)", borderWidth: 1,
    borderColor: "rgba(6,182,212,0.2)", alignItems: "center", justifyContent: "center",
  },
  tosModalTitle:   { color: "#fff", fontSize: 15, fontWeight: "800" },
  tosModalVersion: { color: "#444", fontSize: 11, marginTop: 2 },

  tosScrollHint: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(245,158,11,0.08)", borderBottomWidth: 1,
    borderBottomColor: "rgba(245,158,11,0.2)", paddingHorizontal: 18, paddingVertical: 8,
  },
  tosScrollHintText: { color: "#f59e0b", fontSize: 12, fontWeight: "600" },

  tosModalScroll: { flex: 1 },
  tosModalScrollContent: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 12 },
  tosUpdated: { color: "#333", fontSize: 11, marginBottom: 20 },
  tosSection: { marginBottom: 24 },
  tosSectionTitle: { color: "#fff", fontSize: 14, fontWeight: "800", marginBottom: 8 },
  tosSectionBody: { color: "#666", fontSize: 13, lineHeight: 21 },

  tosModalFooter: {
    paddingHorizontal: 18, paddingTop: 12, paddingBottom: 20,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a",
    gap: 10,
  },
  tosAcceptBtn: {
    backgroundColor: "#06b6d4", borderRadius: 14, paddingVertical: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  tosAcceptBtnLoading: { backgroundColor: "#0a4a55" },
  tosAcceptBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
  tosLockedBtn: {
    backgroundColor: "#0d0d0d", borderRadius: 14, paddingVertical: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  tosLockedBtnText: { color: "#333", fontWeight: "700", fontSize: 15 },
  tosDeclineBtn: {
    backgroundColor: "transparent", borderRadius: 14, paddingVertical: 12,
    alignItems: "center",
  },
  tosDeclineBtnText: { color: "#333", fontWeight: "600", fontSize: 14 },

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

  noticeBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    backgroundColor: "rgba(6,182,212,0.07)",
    borderWidth: 1, borderColor: "rgba(6,182,212,0.2)",
    borderRadius: 16, padding: 14, marginBottom: 24,
  },
  noticeTitle: { color: "#06b6d4", fontSize: 13, fontWeight: "800", marginBottom: 3 },
  noticeBody: { color: "#555", fontSize: 13, lineHeight: 19 },
});
