import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Clipboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { reportError } from "../lib/report-error";
import { supabase } from "../../lib/supabase";
import { sendSecurityAlert } from "../../lib/security-notify";

type Method = "totp" | "phone";

/** Normalizes a US-style phone entry into E.164 (+1XXXXXXXXXX). */
function toE164(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (input.trim().startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export default function MfaSetupScreen() {
  const [method, setMethod] = useState<Method | null>(null);

  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode]         = useState("");
  const [loading, setLoading]   = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [done, setDone]         = useState(false);

  // TOTP-specific
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri]       = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Phone-specific
  const [phoneInput, setPhoneInput]   = useState("");
  const [phoneE164, setPhoneE164]     = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [sendingSms, setSendingSms]   = useState(false);

  async function cleanStaleFactors() {
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const f of existing?.all ?? []) {
      if ((f.status as string) === "unverified") {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }
  }

  // ── TOTP flow ─────────────────────────────────────────────────────────────
  async function startTotp() {
    setMethod("totp");
    setError(null);
    setLoading(true);
    await cleanStaleFactors();

    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "ArcadeTracker" });
    setLoading(false);
    if (error || !data) {
      const msg = error?.message ?? "Could not start 2FA setup.";
      reportError("MfaSetup.enrollTotp", msg);
      setError(msg);
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setUri(data.totp.uri);
  }

  // ── Phone / SMS flow ──────────────────────────────────────────────────────
  async function startPhone() {
    setError(null);
    const e164 = toE164(phoneInput);
    if (!e164) {
      setError("Enter a valid phone number, e.g. (555) 123-4567.");
      return;
    }
    setLoading(true);
    await cleanStaleFactors();

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "phone",
      phone: e164,
      friendlyName: `SMS ${e164.slice(-4)}`,
    });
    if (error || !data) {
      setLoading(false);
      const msg = error?.message ?? "Could not start SMS 2FA setup.";
      reportError("MfaSetup.enrollPhone", msg);
      setError(
        /not enabled|disabled|unsupported/i.test(msg)
          ? "Text-message 2FA isn't available yet — use an authenticator app instead."
          : msg
      );
      return;
    }

    // Challenge immediately — this sends the SMS code
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: data.id });
    setLoading(false);
    if (cErr || !challenge) {
      const msg = cErr?.message ?? "Could not send the text message.";
      reportError("MfaSetup.challengePhone", msg);
      setError(msg);
      return;
    }
    setFactorId(data.id);
    setChallengeId(challenge.id);
    setPhoneE164(e164);
  }

  async function resendSms() {
    if (!factorId || sendingSms) return;
    setSendingSms(true);
    setError(null);
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
    setSendingSms(false);
    if (cErr || !challenge) {
      setError(cErr?.message ?? "Could not resend the code.");
    } else {
      setChallengeId(challenge.id);
    }
  }

  // ── Shared verify ─────────────────────────────────────────────────────────
  async function handleVerify() {
    if (!factorId || code.length !== 6) return;
    setVerifying(true);
    setError(null);

    let chId = challengeId;
    if (!chId) {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
      if (cErr || !challenge) {
        const msg = cErr?.message ?? "Challenge failed.";
        reportError("MfaSetup.handleVerify", msg);
        setError(msg);
        setVerifying(false);
        return;
      }
      chId = challenge.id;
    }

    const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: chId, code });
    setVerifying(false);

    if (vErr) {
      setError("Incorrect code — try again.");
      setCode("");
      if (method === "totp") setChallengeId(null);
    } else {
      sendSecurityAlert("mfa_added");
      setDone(true);
    }
  }

  function handleCopySecret() {
    if (!secret) return;
    Clipboard.setString(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (done) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <View style={styles.successIcon}>
            <Ionicons name="shield-checkmark" size={48} color="#22c55e" />
          </View>
          <Text style={styles.successTitle}>2FA Enabled</Text>
          <Text style={styles.successSub}>
            {method === "phone"
              ? `Codes will be texted to ${phoneE164} when you sign in.`
              : "Your account is now protected with two-factor authentication."}
          </Text>
          <Pressable style={styles.doneBtn} onPress={() => router.back()}>
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color="#06b6d4" size="large" />
          <Text style={styles.loadingText}>
            {method === "phone" ? "Sending code…" : "Preparing setup…"}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const verifyCard = (sub: string) => (
    <View style={styles.stepCard}>
      <Text style={styles.stepNum}>Step 2</Text>
      <Text style={styles.stepTitle}>Enter the 6-digit code</Text>
      <Text style={styles.stepSub}>{sub}</Text>

      <TextInput
        style={styles.codeInput}
        value={code}
        onChangeText={(t) => {
          const d = t.replace(/\D/g, "").slice(0, 6);
          setCode(d);
          if (d.length === 6) setTimeout(() => handleVerify(), 0);
        }}
        keyboardType="number-pad"
        maxLength={6}
        placeholder="000000"
        placeholderTextColor="#555"
        textAlign="center"
        autoFocus={Platform.OS !== "web"}
      />

      {method === "phone" && (
        <Pressable style={styles.resendBtn} onPress={resendSms} disabled={sendingSms}>
          {sendingSms
            ? <ActivityIndicator size="small" color="#06b6d4" />
            : <Text style={styles.resendText}>Didn't get a text? Resend code</Text>}
        </Pressable>
      )}

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Pressable
        style={[styles.verifyBtn, (verifying || code.length !== 6) && styles.verifyBtnDisabled]}
        onPress={handleVerify}
        disabled={verifying || code.length !== 6}
      >
        {verifying
          ? <ActivityIndicator color="#000" size="small" />
          : <>
              <Ionicons name="shield-checkmark-outline" size={18} color="#000" />
              <Text style={styles.verifyBtnText}>Enable 2FA</Text>
            </>
        }
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            if (method && !factorId) { setMethod(null); setError(null); }
            else router.back();
          }}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Two-Factor Authentication</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* ── Method chooser ── */}
        {method === null && (
          <>
            <Text style={styles.chooseTitle}>How do you want to get your codes?</Text>

            <Pressable style={styles.methodCard} onPress={startTotp}>
              <View style={[styles.methodIcon, { backgroundColor: "rgba(6,182,212,0.1)", borderColor: "rgba(6,182,212,0.25)" }]}>
                <Ionicons name="qr-code-outline" size={22} color="#06b6d4" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.methodTitle}>Authenticator app</Text>
                <Text style={styles.methodSub}>
                  Use Microsoft Authenticator, Google Authenticator, or any TOTP app. Works offline — recommended.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#444" />
            </Pressable>

            <Pressable style={styles.methodCard} onPress={() => { setMethod("phone"); setError(null); }}>
              <View style={[styles.methodIcon, { backgroundColor: "rgba(168,85,247,0.1)", borderColor: "rgba(168,85,247,0.25)" }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={22} color="#a855f7" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.methodTitle}>Text message (SMS)</Text>
                <Text style={styles.methodSub}>
                  Get a 6-digit code texted to your phone each time you sign in.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#444" />
            </Pressable>
          </>
        )}

        {/* ── TOTP setup ── */}
        {method === "totp" && factorId && (
          <>
            <View style={styles.stepCard}>
              <Text style={styles.stepNum}>Step 1</Text>
              <Text style={styles.stepTitle}>Scan with your authenticator app</Text>
              <Text style={styles.stepSub}>
                Open your authenticator app → tap + → scan this QR code.
              </Text>

              {Platform.OS === "web" && qrCode ? (
                <View style={styles.qrWrap}>
                  {/* @ts-ignore */}
                  <img src={qrCode} style={{ width: 200, height: 200, display: "block" }} alt="2FA QR code" />
                </View>
              ) : (
                <Pressable style={styles.openAuthBtn} onPress={() => uri && Linking.openURL(uri)}>
                  <Ionicons name="lock-open-outline" size={18} color="#000" />
                  <Text style={styles.openAuthText}>Open in Authenticator App</Text>
                </Pressable>
              )}

              <View style={styles.secretRow}>
                <Text style={styles.secretLabel}>Manual code</Text>
                <Pressable style={styles.secretBox} onPress={handleCopySecret}>
                  <Text style={styles.secretCode}>{secret}</Text>
                  <Ionicons name={copied ? "checkmark" : "copy-outline"} size={14} color={copied ? "#22c55e" : "#555"} />
                </Pressable>
              </View>
            </View>

            {verifyCard("Type the code shown in your authenticator app to confirm setup.")}
          </>
        )}

        {/* ── Phone number entry ── */}
        {method === "phone" && !factorId && (
          <View style={styles.stepCard}>
            <Text style={styles.stepNum}>Step 1</Text>
            <Text style={styles.stepTitle}>Enter your phone number</Text>
            <Text style={styles.stepSub}>
              We'll text a 6-digit code to this number to confirm it, and again each time you sign in. Message and data rates may apply.
            </Text>

            <View style={styles.phoneInputWrap}>
              <Ionicons name="call-outline" size={18} color="#444" />
              <TextInput
                style={styles.phoneInput}
                placeholder="(555) 123-4567"
                placeholderTextColor="#555"
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                value={phoneInput}
                onChangeText={setPhoneInput}
                onSubmitEditing={startPhone}
                autoFocus={Platform.OS !== "web"}
              />
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.verifyBtn, !phoneInput.trim() && styles.verifyBtnDisabled]}
              onPress={startPhone}
              disabled={!phoneInput.trim()}
            >
              <Ionicons name="paper-plane-outline" size={18} color="#000" />
              <Text style={styles.verifyBtnText}>Text me a code</Text>
            </Pressable>
          </View>
        )}

        {/* ── Phone code verify ── */}
        {method === "phone" && factorId && (
          verifyCard(`We sent a code to ${phoneE164}. Enter it below to finish setup.`)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },

  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 14 },
  backBtn: { padding: 4 },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },

  content: { padding: 18, gap: 16 },

  chooseTitle: { color: "#8a8a8a", fontSize: 14, lineHeight: 20, marginBottom: 2 },
  methodCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "#111", borderRadius: 20, padding: 18,
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  methodIcon: {
    width: 46, height: 46, borderRadius: 14, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  methodTitle: { color: "#fff", fontSize: 15.5, fontWeight: "900", marginBottom: 3 },
  methodSub: { color: "#8a8a8a", fontSize: 12.5, lineHeight: 17 },

  stepCard: {
    backgroundColor: "#111", borderRadius: 20, padding: 20,
    borderWidth: 1, borderColor: "#1a1a1a", gap: 10,
  },
  stepNum: { color: "#06b6d4", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  stepTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },
  stepSub: { color: "#8a8a8a", fontSize: 13, lineHeight: 18 },

  qrWrap: {
    alignSelf: "center", backgroundColor: "#fff",
    padding: 12, borderRadius: 16, marginTop: 4,
  },

  openAuthBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#06b6d4", borderRadius: 14,
    paddingVertical: 14, marginTop: 4,
  },
  openAuthText: { color: "#000", fontWeight: "900", fontSize: 15 },

  secretRow: { gap: 6 },
  secretLabel: { color: "#777", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  secretBox: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#0a0a0a", borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  secretCode: { color: "#888", fontSize: 13, fontFamily: Platform.OS === "ios" ? "Courier New" : "monospace", letterSpacing: 1 },

  phoneInputWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#0a0a0a", borderRadius: 14,
    borderWidth: 1, borderColor: "#1a1a1a", paddingHorizontal: 14,
  },
  phoneInput: { flex: 1, color: "#fff", paddingVertical: 15, fontSize: 16 },

  codeInput: {
    fontSize: 28, fontWeight: "900", letterSpacing: 16,
    color: "#fff", backgroundColor: "#0a0a0a",
    borderRadius: 14, paddingVertical: 18,
    borderWidth: 1, borderColor: "#1a1a1a",
  },

  resendBtn: { alignItems: "center", paddingVertical: 6 },
  resendText: { color: "#06b6d4", fontSize: 13, fontWeight: "700" },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 10,
    padding: 10, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
  },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },

  verifyBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#06b6d4", borderRadius: 14, paddingVertical: 16,
  },
  verifyBtnDisabled: { backgroundColor: "#0a4a55", opacity: 0.6 },
  verifyBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },

  // Success
  successIcon: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: "rgba(34,197,94,0.1)", borderWidth: 1,
    borderColor: "rgba(34,197,94,0.25)", alignItems: "center", justifyContent: "center",
  },
  successTitle: { color: "#22c55e", fontSize: 24, fontWeight: "900" },
  successSub: { color: "#8a8a8a", fontSize: 14, textAlign: "center", lineHeight: 20 },
  doneBtn: {
    backgroundColor: "#06b6d4", borderRadius: 14,
    paddingHorizontal: 48, paddingVertical: 16, marginTop: 8,
  },
  doneBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },

  loadingText: { color: "#8a8a8a", fontSize: 14, marginTop: 8 },
});
