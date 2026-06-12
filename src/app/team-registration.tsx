import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

type ActiveSeason = {
  id: string;
  name: string;
  team_fee_cents: number;
  individual_fee_cents: number;
  prize_1st_cents: number;
  prize_2nd_cents: number;
  prize_3rd_cents: number;
  prize_4th_cents: number;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
};

type ExistingReg = {
  id: string;
  registration_type: "team" | "individual";
  status: "pending_payment" | "paid" | "refunded" | "cancelled";
  checkout_url: string | null;
  team_id: string | null;
};

function cents(n: number) {
  return `$${(n / 100).toFixed(0)}`;
}

export default function TeamRegistrationScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [season, setSeason] = useState<ActiveSeason | null>(null);
  const [existingReg, setExistingReg] = useState<ExistingReg | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<"team" | "individual" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  async function load() {
    if (!user) return;
    const { data: seasonData } = await supabase
      .from("seasons")
      .select("id, name, team_fee_cents, individual_fee_cents, prize_1st_cents, prize_2nd_cents, prize_3rd_cents, prize_4th_cents, registration_opens_at, registration_closes_at")
      .eq("status", "active")
      .eq("registration_required", true)
      .maybeSingle();

    setSeason(seasonData ?? null);

    if (seasonData) {
      const { data: regData } = await supabase
        .from("team_registrations")
        .select("id, registration_type, status, checkout_url, team_id")
        .eq("user_id", user.id)
        .eq("season_id", seasonData.id)
        .maybeSingle();
      setExistingReg(regData ?? null);
      if (regData) {
        setSelected(regData.registration_type);
        setCheckoutUrl(regData.checkout_url);
      }
    }
    setLoading(false);
  }

  useEffect(() => { if (user) load(); }, [user]);

  useFocusEffect(useCallback(() => {
    if (user && !loading) load();
  }, [user]));

  async function handleRegister() {
    if (!user || !season || !selected) return;
    setError(null);
    setSubmitting(true);

    try {
      let regId: string;

      if (existingReg && existingReg.status === "pending_payment") {
        regId = existingReg.id;
      } else {
        // Insert new registration
        const { data: inserted, error: insertErr } = await supabase
          .from("team_registrations")
          .insert({
            user_id: user.id,
            season_id: season.id,
            registration_type: selected,
            status: "pending_payment",
          })
          .select("id")
          .single();

        if (insertErr || !inserted) {
          // May already exist from a prior attempt
          const { data: existing } = await supabase
            .from("team_registrations")
            .select("id, registration_type, status, checkout_url")
            .eq("user_id", user.id)
            .eq("season_id", season.id)
            .maybeSingle();
          if (!existing) {
            setError("Could not start registration. Please try again.");
            return;
          }
          regId = existing.id;
          setExistingReg(existing as ExistingReg);
          if (existing.checkout_url) {
            setCheckoutUrl(existing.checkout_url);
            await Linking.openURL(existing.checkout_url);
            return;
          }
        } else {
          regId = inserted.id;
        }
      }

      // If we already have a checkout URL (idempotent re-open)
      if (existingReg?.checkout_url && existingReg.id === regId) {
        setCheckoutUrl(existingReg.checkout_url);
        await Linking.openURL(existingReg.checkout_url);
        return;
      }

      // Create payment link via server
      const apiBase = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
      const resp = await fetch(`${apiBase}/api/square/registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationId: regId }),
      });
      const json = await resp.json();

      if (!resp.ok || !json.checkoutUrl) {
        setError(json.error ?? "Failed to create payment link. Please try again.");
        return;
      }

      setCheckoutUrl(json.checkoutUrl);
      await Linking.openURL(json.checkoutUrl);
      // Refresh so we pick up the checkout_url saved by the API
      await load();
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || loading) {
    return (
      <View style={s.loader}>
        <ActivityIndicator size="large" color="#06b6d4" />
      </View>
    );
  }

  if (!season) {
    return (
      <SafeAreaView style={s.root} edges={["top", "bottom"]}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Text style={s.title}>Registration</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={s.emptyWrap}>
          <Ionicons name="calendar-outline" size={48} color="#333" />
          <Text style={s.emptyTitle}>No Active Season</Text>
          <Text style={s.emptySub}>There is no active season with paid registration open right now.</Text>
          <Pressable style={s.backBtn2} onPress={() => router.back()}>
            <Text style={s.backBtn2Text}>Back to Teams</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Already paid
  if (existingReg?.status === "paid") {
    return (
      <SafeAreaView style={s.root} edges={["top", "bottom"]}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Text style={s.title}>Registration</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={s.emptyWrap}>
          <View style={s.paidIcon}>
            <Ionicons name="checkmark-circle" size={56} color="#22c55e" />
          </View>
          <Text style={s.paidTitle}>You're Registered!</Text>
          <Text style={s.paidSub}>
            {existingReg.registration_type === "team"
              ? "Your team registration for " + season.name + " is confirmed."
              : "Your individual registration for " + season.name + " is confirmed. An admin will assign you to a team."}
          </Text>
          <Pressable style={s.goTeamsBtn} onPress={() => router.back()}>
            <Ionicons name="people-outline" size={16} color="#000" />
            <Text style={s.goTeamsBtnText}>Go to Teams</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.title}>Season Registration</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Season banner */}
        <View style={s.seasonCard}>
          <View style={s.seasonBadge}>
            <Ionicons name="trophy-outline" size={14} color="#f59e0b" />
            <Text style={s.seasonBadgeText}>Active Season</Text>
          </View>
          <Text style={s.seasonName}>{season.name}</Text>
          <Text style={s.seasonSub}>Compete against other teams across the season.</Text>
        </View>

        {/* Prize pool */}
        <Text style={s.sectionLabel}>Prize Pool</Text>
        <View style={s.prizeCard}>
          <PrizeRow place={1} label="1st Place" amount={season.prize_1st_cents} color="#f59e0b" icon="trophy" />
          <PrizeRow place={2} label="2nd Place" amount={season.prize_2nd_cents} color="#9ca3af" icon="medal" />
          <PrizeRow place={3} label="3rd Place" amount={season.prize_3rd_cents} color="#b45309" icon="medal-outline" />
          <PrizeRow place={4} label="4th Place" amount={season.prize_4th_cents} color="#555" icon="medal-outline" last />
        </View>

        {/* Registration options */}
        <Text style={s.sectionLabel}>Choose Registration</Text>

        <Pressable
          style={[s.optCard, selected === "team" && s.optCardSelected]}
          onPress={() => setSelected("team")}
        >
          <View style={s.optTop}>
            <View style={[s.optIcon, selected === "team" && s.optIconSelected]}>
              <Ionicons name="people" size={22} color={selected === "team" ? "#000" : "#06b6d4"} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.optTitle}>Team Registration</Text>
              <Text style={s.optPrice}>{cents(season.team_fee_cents)}</Text>
            </View>
            <View style={[s.radio, selected === "team" && s.radioSelected]}>
              {selected === "team" && <View style={s.radioDot} />}
            </View>
          </View>
          <Text style={s.optDesc}>
            Register your team of up to 3 players. You'll be able to create and manage your team after payment.
          </Text>
        </Pressable>

        <Pressable
          style={[s.optCard, selected === "individual" && s.optCardSelected]}
          onPress={() => setSelected("individual")}
        >
          <View style={s.optTop}>
            <View style={[s.optIcon, selected === "individual" && s.optIconSelected]}>
              <Ionicons name="person" size={22} color={selected === "individual" ? "#000" : "#06b6d4"} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.optTitle}>Individual Registration</Text>
              <Text style={s.optPrice}>{cents(season.individual_fee_cents)}</Text>
            </View>
            <View style={[s.radio, selected === "individual" && s.radioSelected]}>
              {selected === "individual" && <View style={s.radioDot} />}
            </View>
          </View>
          <Text style={s.optDesc}>
            Register as a solo player. An admin will assign you to a team with other individual registrants.
          </Text>
        </Pressable>

        {/* Pending payment re-entry notice */}
        {existingReg?.status === "pending_payment" && (
          <View style={s.pendingNotice}>
            <Ionicons name="time-outline" size={15} color="#f59e0b" />
            <Text style={s.pendingNoticeText}>
              You started a registration. Complete the payment below to activate it.
            </Text>
          </View>
        )}

        {error && (
          <View style={s.errorBox}>
            <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* Pay button */}
        <Pressable
          style={[s.payBtn, (!selected || submitting) && s.payBtnOff]}
          onPress={handleRegister}
          disabled={!selected || submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <>
              <Ionicons name="card-outline" size={18} color="#000" />
              <Text style={s.payBtnText}>
                {existingReg?.status === "pending_payment" && checkoutUrl
                  ? "Open Payment Again"
                  : selected
                    ? `Pay ${cents(selected === "team" ? season.team_fee_cents : season.individual_fee_cents)} — Register`
                    : "Select a registration type"}
              </Text>
            </>
          )}
        </Pressable>

        {checkoutUrl && (
          <Text style={s.hint}>
            You'll be taken to Square checkout. Return to this screen after payment to see your status.
          </Text>
        )}

        <Text style={s.legalNote}>
          All registrations are non-refundable. Prizes are paid at the end of the season based on final standings.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function PrizeRow({ label, amount, color, icon, last }: { place: number; label: string; amount: number; color: string; icon: string; last?: boolean }) {
  return (
    <View style={[pr.row, !last && pr.rowBorder]}>
      <Ionicons name={icon as any} size={18} color={color} />
      <Text style={pr.label}>{label}</Text>
      <Text style={[pr.amount, { color }]}>{cents(amount)}</Text>
    </View>
  );
}

const pr = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e1e1e" },
  label: { flex: 1, color: "#aaa", fontSize: 14, fontWeight: "600" },
  amount: { fontSize: 18, fontWeight: "900" },
});

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontSize: 17, fontWeight: "900" },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48, gap: 16 },

  seasonCard: {
    backgroundColor: "rgba(245,158,11,0.06)", borderRadius: 20, padding: 20,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
  },
  seasonBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginBottom: 8, alignSelf: "flex-start",
    backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  seasonBadgeText: { color: "#f59e0b", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  seasonName: { color: "#fff", fontSize: 22, fontWeight: "900", marginBottom: 4 },
  seasonSub: { color: "#888", fontSize: 13 },

  sectionLabel: { color: "#444", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2 },

  prizeCard: {
    backgroundColor: "#0d0d0d", borderRadius: 18, paddingHorizontal: 18, paddingVertical: 4,
    borderWidth: 1, borderColor: "#1e1e1e",
  },

  optCard: {
    backgroundColor: "#0d0d0d", borderRadius: 18, padding: 18,
    borderWidth: 1.5, borderColor: "#1e1e1e",
  },
  optCardSelected: { borderColor: "#06b6d4", backgroundColor: "rgba(6,182,212,0.04)" },
  optTop: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 10 },
  optIcon: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: "rgba(6,182,212,0.1)", alignItems: "center", justifyContent: "center",
  },
  optIconSelected: { backgroundColor: "#06b6d4" },
  optTitle: { color: "#fff", fontSize: 16, fontWeight: "800", marginBottom: 2 },
  optPrice: { color: "#06b6d4", fontSize: 20, fontWeight: "900" },
  optDesc: { color: "#555", fontSize: 13, lineHeight: 18 },
  radio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: "#333",
    alignItems: "center", justifyContent: "center",
  },
  radioSelected: { borderColor: "#06b6d4" },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#06b6d4" },

  pendingNotice: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "rgba(245,158,11,0.06)", borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
  },
  pendingNoticeText: { flex: 1, color: "#f59e0b", fontSize: 13, lineHeight: 18 },

  errorBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
  },
  errorText: { flex: 1, color: "#ef4444", fontSize: 13 },

  payBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#06b6d4", borderRadius: 16, paddingVertical: 17, marginTop: 8,
  },
  payBtnOff: { backgroundColor: "#1a1a1a" },
  payBtnText: { color: "#000", fontSize: 16, fontWeight: "900" },

  hint: { color: "#444", fontSize: 12, textAlign: "center", lineHeight: 17 },
  legalNote: { color: "#2a2a2a", fontSize: 11, textAlign: "center", lineHeight: 16 },

  // No season / already paid states
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  emptyTitle: { color: "#fff", fontSize: 20, fontWeight: "900", textAlign: "center" },
  emptySub: { color: "#555", fontSize: 14, textAlign: "center", lineHeight: 20 },
  backBtn2: { backgroundColor: "#1a1a1a", borderRadius: 14, paddingHorizontal: 28, paddingVertical: 13, marginTop: 8 },
  backBtn2Text: { color: "#06b6d4", fontWeight: "800", fontSize: 15 },

  paidIcon: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: "rgba(34,197,94,0.1)", alignItems: "center", justifyContent: "center",
    marginBottom: 8,
  },
  paidTitle: { color: "#fff", fontSize: 22, fontWeight: "900", textAlign: "center" },
  paidSub: { color: "#555", fontSize: 14, textAlign: "center", lineHeight: 20 },
  goTeamsBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#06b6d4", borderRadius: 14, paddingHorizontal: 28, paddingVertical: 13, marginTop: 8,
  },
  goTeamsBtnText: { color: "#000", fontSize: 15, fontWeight: "900" },
});
