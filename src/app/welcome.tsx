import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Head from "expo-router/head";
import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

type PublicStanding = { team_name: string; matches_played: number; gold: number; total_points: number };

const FEATURES: { icon: string; title: string; body: string }[] = [
  { icon: "bowling-ball-outline", title: "8-week skee-ball seasons", body: "Teams of 3 battle every Monday night. Placements earn league points, and the season winners take cash prizes." },
  { icon: "stats-chart-outline", title: "Serious stat tracking", body: "Every ball is recorded — averages, hundo streaks, lane stats, clutch ratings, and head-to-head scouting reports." },
  { icon: "radio-outline", title: "Live league nights", body: "Watch every lane update in real time, with standings that shift ball by ball." },
  { icon: "trophy-outline", title: "Cash prizes", body: "1st place takes $500. 2nd gets $250. 3rd and 4th each get $100. Bragging rights are free." },
];

/** Public landing page — no login required. */
export default function WelcomeScreen() {
  const [standings, setStandings] = useState<PublicStanding[]>([]);
  const [seasonName, setSeasonName] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("rpc_public_standings").then(({ data }) => {
      if (data && (data as any).ok) {
        setStandings(((data as any).standings ?? []).slice(0, 8));
        setSeasonName((data as any).season_name ?? null);
      }
    });
  }, []);

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Head>
        <title>ArcadeTracker — Skee-Ball League</title>
        <meta name="description" content="Join the Monday night skee-ball league. Live scores, season stats, and cash prizes." />
      </Head>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={s.hero}>
          <View style={s.logoBadge}>
            <Ionicons name="bowling-ball" size={34} color="#06b6d4" />
          </View>
          <Text style={s.heroTitle}>Monday nights are{"\n"}for skee-ball.</Text>
          <Text style={s.heroSub}>
            ArcadeTracker runs our bar's skee-ball league — live scores, 8-week seasons,
            deep stats, and cash prizes for the top teams.
          </Text>
          <View style={s.ctaRow}>
            <Pressable style={s.ctaPrimary} onPress={() => router.push("/signup" as any)}>
              <Text style={s.ctaPrimaryText}>Join the League</Text>
            </Pressable>
            <Pressable style={s.ctaSecondary} onPress={() => router.push("/login" as any)}>
              <Text style={s.ctaSecondaryText}>Sign In</Text>
            </Pressable>
          </View>
        </View>

        {/* Guest actions — no account needed */}
        <View style={s.guestCard}>
          <Text style={s.guestTitle}>At the bar right now? No account needed.</Text>
          <View style={s.guestRow}>
            <Pressable style={s.guestBtn} onPress={() => router.push("/food" as any)}>
              <Ionicons name="restaurant-outline" size={22} color="#f59e0b" />
              <Text style={s.guestBtnTitle}>Order Food</Text>
              <Text style={s.guestBtnSub}>Browse the menu & check out</Text>
            </Pressable>
            <Pressable style={s.guestBtn} onPress={() => router.push("/karaoke" as any)}>
              <Ionicons name="mic-outline" size={22} color="#a855f7" />
              <Text style={s.guestBtnTitle}>Karaoke</Text>
              <Text style={s.guestBtnSub}>Request a song as a guest</Text>
            </Pressable>
          </View>
        </View>

        {/* Live standings teaser */}
        {standings.length > 0 && (
          <View style={s.standingsCard}>
            <View style={s.standingsHeader}>
              <View style={s.liveDot} />
              <Text style={s.standingsTitle}>
                {seasonName ? `${seasonName} Standings` : "League Standings"}
              </Text>
            </View>
            {standings.map((t, i) => (
              <View key={t.team_name} style={s.standingRow}>
                <Text style={s.standingRank}>{i + 1}</Text>
                <Text style={s.standingName} numberOfLines={1}>{t.team_name}</Text>
                {t.gold > 0 && <Text style={s.standingGold}>{t.gold}🥇</Text>}
                <Text style={s.standingPts}>{t.total_points} pts</Text>
              </View>
            ))}
            <Text style={s.standingsNote}>Sign in to see full stats, schedules & player records</Text>
          </View>
        )}

        {/* Features */}
        {FEATURES.map((f) => (
          <View key={f.title} style={s.featureCard}>
            <View style={s.featureIcon}>
              <Ionicons name={f.icon as any} size={20} color="#06b6d4" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.featureTitle}>{f.title}</Text>
              <Text style={s.featureBody}>{f.body}</Text>
            </View>
          </View>
        ))}

        {/* Bottom CTA */}
        <Pressable style={[s.ctaPrimary, { marginTop: 10 }]} onPress={() => router.push("/signup" as any)}>
          <Text style={s.ctaPrimaryText}>Create Your Free Account</Text>
        </Pressable>
        <Text style={s.finePrint}>
          Free to join — browse teams, track scores, and follow the league.{"\n"}
          Season registration: $200 per team of 3, or $50 solo.
        </Text>
        <View style={s.legalRow}>
          <Pressable onPress={() => router.push("/privacy" as any)}>
            <Text style={s.legalLink}>Privacy Policy</Text>
          </Pressable>
          <Text style={s.legalDot}>·</Text>
          <Pressable onPress={() => router.push("/terms" as any)}>
            <Text style={s.legalLink}>Terms of Service</Text>
          </Pressable>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  content: { paddingHorizontal: 22, paddingTop: 24 },

  hero: { alignItems: "center", paddingVertical: 28 },
  logoBadge: {
    width: 72, height: 72, borderRadius: 24, marginBottom: 20,
    backgroundColor: "rgba(6,182,212,0.08)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(6,182,212,0.25)",
  },
  heroTitle: { color: "#fff", fontSize: 34, fontWeight: "900", textAlign: "center", letterSpacing: -0.8, lineHeight: 40 },
  heroSub: { color: "#999", fontSize: 15, textAlign: "center", lineHeight: 22, marginTop: 14, maxWidth: 420 },
  ctaRow: { flexDirection: "row", gap: 10, marginTop: 24 },
  ctaPrimary: {
    backgroundColor: "#06b6d4", borderRadius: 16, paddingHorizontal: 28, paddingVertical: 15,
    alignItems: "center",
  },
  ctaPrimaryText: { color: "#000", fontSize: 15, fontWeight: "900" },
  ctaSecondary: {
    backgroundColor: "#141414", borderRadius: 16, paddingHorizontal: 28, paddingVertical: 15,
    borderWidth: 1, borderColor: "#2a2a2a",
  },
  ctaSecondaryText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  guestCard: {
    backgroundColor: "rgba(245,158,11,0.05)", borderRadius: 20, padding: 16, marginTop: 4,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
  },
  guestTitle: { color: "#fff", fontSize: 14.5, fontWeight: "800", textAlign: "center", marginBottom: 12 },
  guestRow: { flexDirection: "row", gap: 10 },
  guestBtn: {
    flex: 1, alignItems: "center", gap: 4,
    backgroundColor: "#111", borderRadius: 16, paddingVertical: 16, paddingHorizontal: 10,
    borderWidth: 1, borderColor: "#222",
  },
  guestBtnTitle: { color: "#fff", fontSize: 14.5, fontWeight: "900", marginTop: 4 },
  guestBtnSub: { color: "#888", fontSize: 11.5, textAlign: "center" },

  standingsCard: {
    backgroundColor: "#0d0d0d", borderRadius: 20, padding: 18, marginVertical: 16,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  standingsHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#22c55e" },
  standingsTitle: { color: "#fff", fontSize: 15, fontWeight: "900" },
  standingRow: {
    flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a",
  },
  standingRank: { width: 22, color: "#06b6d4", fontSize: 13, fontWeight: "900" },
  standingName: { flex: 1, color: "#fff", fontSize: 14, fontWeight: "700" },
  standingGold: { color: "#f59e0b", fontSize: 12 },
  standingPts: { color: "#06b6d4", fontSize: 14, fontWeight: "900" },
  standingsNote: { color: "#777", fontSize: 11.5, textAlign: "center", marginTop: 10 },

  featureCard: {
    flexDirection: "row", gap: 14,
    backgroundColor: "#0d0d0d", borderRadius: 18, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  featureIcon: {
    width: 42, height: 42, borderRadius: 13,
    backgroundColor: "rgba(6,182,212,0.08)", alignItems: "center", justifyContent: "center",
  },
  featureTitle: { color: "#fff", fontSize: 15.5, fontWeight: "800", marginBottom: 4 },
  featureBody: { color: "#999", fontSize: 13.5, lineHeight: 19 },

  finePrint: { color: "#777", fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 14 },
  legalRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14 },
  legalLink: { color: "#888", fontSize: 12, fontWeight: "700", textDecorationLine: "underline" },
  legalDot: { color: "#444", fontSize: 12 },
});
