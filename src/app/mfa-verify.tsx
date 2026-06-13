import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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

type VerifiedFactor = { id: string; type: "totp" | "phone"; phone?: string };

export default function MfaVerifyScreen() {
  const [factors, setFactors]       = useState<VerifiedFactor[]>([]);
  const [active, setActive]         = useState<VerifiedFactor | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode]             = useState("");
  const [loading, setLoading]       = useState(true);
  const [verifying, setVerifying]   = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => { setup(); }, []);

  async function setup() {
    const { data } = await supabase.auth.mfa.listFactors();
    const verified: VerifiedFactor[] = [
      ...(data?.totp ?? [])
        .filter((f) => f.status === "verified")
        .map((f) => ({ id: f.id, type: "totp" as const })),
    ...(((data as any)?.phone ?? []) as any[])
        .filter((f) => f.status === "verified")
        .map((f) => ({ id: f.id, type: "phone" as const, phone: f.phone })),
    ];
    if (verified.length === 0) {
      router.replace("/");
      return;
    }
    setFactors(verified);
    // Prefer TOTP (works offline); fall back to SMS
    const preferred = verified.find((f) => f.type === "totp") ?? verified[0];
    await startChallenge(preferred);
    setLoading(false);
  }

  async function startChallenge(factor: VerifiedFactor) {
    setActive(factor);
    setCode("");
    setError(null);
    setChallengeId(null);
    // For phone factors the challenge call sends the SMS
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (cErr || !challenge) {
      const msg = "Could not start verification. Please try again.";
      reportError("MfaVerify.startChallenge", cErr?.message ?? msg);
      setError(cErr?.message ?? msg);
      return;
    }
    setChallengeId(challenge.id);
  }

  async function resendSms() {
    if (!active || active.type !== "phone" || sendingSms) return;
    setSendingSms(true);
    await startChallenge(active);
    setSendingSms(false);
  }

  async function handleVerify() {
    if (!active || !challengeId || code.length !== 6) return;
    setVerifying(true);
    setError(null);

    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId: active.id,
      challengeId,
      code,
    });
    setVerifying(false);

    if (vErr) {
      setError("Incorrect code — try again.");
      setCode("");
      // TOTP challenges are reusable enough to refresh silently; for SMS
      // keep the same challenge so we don't burn texts on typos.
      if (active.type === "totp") {
        const { data: newChallenge } = await supabase.auth.mfa.challenge({ factorId: active.id });
        if (newChallenge) setChallengeId(newChallenge.id);
      }
    } else {
      router.replace("/");
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color="#06b6d4" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const otherFactor = factors.find((f) => f.id !== active?.id);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Ionicons
            name={active?.type === "phone" ? "chatbubble-ellipses-outline" : "shield-outline"}
            size={40}
            color="#06b6d4"
          />
        </View>
        <Text style={styles.title}>Two-Factor Authentication</Text>
        <Text style={styles.sub}>
          {active?.type === "phone"
            ? `Enter the 6-digit code we texted to ${active.phone ?? "your phone"}.`
            : "Enter the 6-digit code from your authenticator app to continue."}
        </Text>

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

        {active?.type === "phone" && (
          <Pressable style={styles.linkBtn} onPress={resendSms} disabled={sendingSms}>
            {sendingSms
              ? <ActivityIndicator size="small" color="#06b6d4" />
              : <Text style={styles.linkText}>Didn't get a text? Resend code</Text>}
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
                <Text style={styles.verifyBtnText}>Verify</Text>
              </>
          }
        </Pressable>

        {otherFactor && (
          <Pressable style={styles.linkBtn} onPress={() => startChallenge(otherFactor)}>
            <Text style={styles.linkText}>
              {otherFactor.type === "phone"
                ? `Text a code to ${otherFactor.phone ?? "my phone"} instead`
                : "Use my authenticator app instead"}
            </Text>
          </Pressable>
        )}

        <Pressable
          style={styles.signOutLink}
          onPress={() => { supabase.auth.signOut().catch(() => {}); router.replace("/login"); }}
        >
          <Text style={styles.signOutText}>Sign out and use a different account</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },

  iconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "rgba(6,182,212,0.1)", borderWidth: 1,
    borderColor: "rgba(6,182,212,0.25)", alignItems: "center", justifyContent: "center",
    marginBottom: 8,
  },

  title: { color: "#fff", fontSize: 22, fontWeight: "900", textAlign: "center" },
  sub:   { color: "#8a8a8a", fontSize: 14, textAlign: "center", lineHeight: 20, maxWidth: 280 },

  codeInput: {
    width: "100%",
    fontSize: 28, fontWeight: "900", letterSpacing: 16,
    color: "#fff", backgroundColor: "#0a0a0a",
    borderRadius: 14, paddingVertical: 18,
    borderWidth: 1, borderColor: "#1a1a1a",
    marginTop: 8,
  },

  linkBtn: { paddingVertical: 4, minHeight: 24, justifyContent: "center" },
  linkText: { color: "#06b6d4", fontSize: 13, fontWeight: "700", textAlign: "center" },

  errorBox: {
    width: "100%",
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 10,
    padding: 10, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
  },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },

  verifyBtn: {
    width: "100%",
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#06b6d4", borderRadius: 14, paddingVertical: 16,
  },
  verifyBtnDisabled: { backgroundColor: "#0a4a55", opacity: 0.6 },
  verifyBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },

  signOutLink: { marginTop: 8, paddingVertical: 8 },
  signOutText: { color: "#333", fontSize: 13, textAlign: "center" },
});
