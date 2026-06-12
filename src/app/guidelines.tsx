import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Head from "expo-router/head";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const RULES: { icon: string; title: string; body: string }[] = [
  {
    icon: "happy-outline",
    title: "Keep it friendly",
    body: "This is a bar league, not a battleground. Trash talk is part of the game — harassment, bullying, or personal attacks are not. If it wouldn't fly at the lanes in person, it doesn't fly here.",
  },
  {
    icon: "ban-outline",
    title: "No hate, ever",
    body: "Racism, sexism, homophobia, or any kind of hate speech gets removed and can get your account banned. Zero tolerance.",
  },
  {
    icon: "image-outline",
    title: "Keep content appropriate",
    body: "No nudity, sexual content, gore, or violent imagery in posts, comments, photos, avatars, or team photos. Everything here is visible to the whole league.",
  },
  {
    icon: "megaphone-outline",
    title: "No spam",
    body: "Don't flood the feed or forums with repetitive posts, ads, or links. Promote your team, not your crypto.",
  },
  {
    icon: "person-outline",
    title: "Be yourself",
    body: "Don't impersonate other players, staff, or officials. One account per person.",
  },
  {
    icon: "trophy-outline",
    title: "Play it straight",
    body: "Enter scores honestly. Misreporting scores or gaming the league system ruins it for everyone — disputes exist for honest mistakes, and admins review the ball-by-ball record.",
  },
  {
    icon: "flag-outline",
    title: "Report, don't retaliate",
    body: "See something that breaks these rules? Use the Report option on any post, comment, or profile. Our team reviews every report. You can also block users to hide their content from your view.",
  },
];

export default function GuidelinesScreen() {
  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Head><title>Community Guidelines · ArcadeTracker</title></Head>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/")}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>Community Guidelines</Text>
      </View>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.intro}>
          ArcadeTracker is the home of our skee-ball league — scores, smack talk, and Monday nights.
          A few rules keep it fun for everyone:
        </Text>
        {RULES.map((r) => (
          <View key={r.title} style={s.card}>
            <View style={s.cardIcon}>
              <Ionicons name={r.icon as any} size={18} color="#06b6d4" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{r.title}</Text>
              <Text style={s.cardBody}>{r.body}</Text>
            </View>
          </View>
        ))}
        <Text style={s.outro}>
          Breaking these rules can lead to content removal, score forfeits, suspension, or a permanent ban,
          at the discretion of league officials. Repeated or severe violations skip the warnings.
        </Text>
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  content: { paddingHorizontal: 18, paddingTop: 18 },
  intro: { color: "#aaa", fontSize: 14.5, lineHeight: 21, marginBottom: 18 },
  card: {
    flexDirection: "row", gap: 13,
    backgroundColor: "#0d0d0d", borderRadius: 16, padding: 15, marginBottom: 10,
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  cardIcon: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: "rgba(6,182,212,0.08)", alignItems: "center", justifyContent: "center",
  },
  cardTitle: { color: "#fff", fontSize: 15, fontWeight: "800", marginBottom: 4 },
  cardBody: { color: "#999", fontSize: 13.5, lineHeight: 19 },
  outro: { color: "#777", fontSize: 12.5, lineHeight: 18, marginTop: 10, fontStyle: "italic" },
});
