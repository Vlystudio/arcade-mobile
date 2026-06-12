import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Clipboard,
  Linking,
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

export default function MfaSetupScreen() {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode]     = useState<string | null>(null);
  const [secret, setSecret]     = useState<string | null>(null);
  const [uri, setUri]           = useState<string | null>(null);
  const [code, setCode]         = useState("");
  const [loading, setLoading]   = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);
  const [done, setDone]         = useState(false);

  useEffect(() => { enroll(); }, []);

  async function enroll() {
    setLoading(true);
    // Un-enroll any stale unverified factor first
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const f of existing?.totp ?? []) {
      if ((f.status as string) === "unverified") {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }

    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "ArcadeTracker" });
    setLoading(false);
    if (error || !data) {
      const msg = error?.message ?? "Could not start 2FA setup.";
      reportError("MfaSetup.enroll", msg);
      setError(msg);
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setUri(data.totp.uri);
  }

  async function handleVerify() {
    if (!factorId || code.length !== 6) return;
    setVerifying(true);
    setError(null);

    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
    if (cErr || !challenge) {
      const msg = cErr?.message ?? "Challenge failed.";
      reportError("MfaSetup.handleVerify", msg);
      setError(msg);
      setVerifying(false);
      return;
    }

    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });
    setVerifying(false);

    if (vErr) {
      setError("Incorrect code — try again.");
      setCode("");
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
            Your account is now protected with two-factor authentication.
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
          <Text style={styles.loadingText}>Preparing setup…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Two-Factor Authentication</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.stepCard}>
          <Text style={styles.stepNum}>Step 1</Text>
          <Text style={styles.stepTitle}>Scan with Microsoft Authenticator</Text>
          <Text style={styles.stepSub}>
            Open Microsoft Authenticator → tap + → scan this QR code.
          </Text>

          {/* QR code — native <img> on web, secret key on native */}
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

          {/* Manual secret */}
          <View style={styles.secretRow}>
            <Text style={styles.secretLabel}>Manual code</Text>
            <Pressable style={styles.secretBox} onPress={handleCopySecret}>
              <Text style={styles.secretCode}>{secret}</Text>
              <Ionicons name={copied ? "checkmark" : "copy-outline"} size={14} color={copied ? "#22c55e" : "#555"} />
            </Pressable>
          </View>
        </View>

        <View style={styles.stepCard}>
          <Text style={styles.stepNum}>Step 2</Text>
          <Text style={styles.stepTitle}>Enter the 6-digit code</Text>
          <Text style={styles.stepSub}>Type the code shown in your authenticator app to confirm setup.</Text>

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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },

  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 14 },
  backBtn: { padding: 4 },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },

  content: { flex: 1, padding: 18, gap: 16 },

  stepCard: {
    backgroundColor: "#111", borderRadius: 20, padding: 20,
    borderWidth: 1, borderColor: "#1e1e1e", gap: 10,
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
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  secretCode: { color: "#888", fontSize: 13, fontFamily: Platform.OS === "ios" ? "Courier New" : "monospace", letterSpacing: 1 },

  codeInput: {
    fontSize: 28, fontWeight: "900", letterSpacing: 16,
    color: "#fff", backgroundColor: "#0a0a0a",
    borderRadius: 14, paddingVertical: 18,
    borderWidth: 1, borderColor: "#1e1e1e",
  },

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
