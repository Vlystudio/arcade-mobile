import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function TermsScreen() {
  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>Terms of Service</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Text style={s.updated}>Last updated: June 2025</Text>

        <Section title="Acceptance">
          By downloading or using ArcadeTracker you agree to these Terms of Service. If you do
          not agree, do not use the app.
        </Section>

        <Section title="Eligibility">
          You must be at least 13 years old to use ArcadeTracker. By using the app you
          represent that you meet this requirement.
        </Section>

        <Section title="Your Account">
          {"• You are responsible for keeping your credentials secure.\n• You are responsible for all activity under your account.\n• Do not share your account with others.\n• Notify us immediately if you suspect unauthorized access."}
        </Section>

        <Section title="Acceptable Use">
          {"You agree not to:\n\n• Submit false or inflated scores.\n• Upload content that is illegal, harmful, harassing, defamatory, or obscene.\n• Attempt to reverse-engineer, scrape, or disrupt the service.\n• Impersonate another user or venue staff.\n• Use the app for any commercial purpose without our written consent."}
        </Section>

        <Section title="User Content">
          You retain ownership of content you post (photos, text). By posting, you grant
          ArcadeTracker a non-exclusive, royalty-free license to display and store that
          content to operate the service. We may remove content that violates these terms.
        </Section>

        <Section title="Score Integrity">
          Scores are subject to admin review. Scores submitted with falsified evidence or
          achieved via cheating may be removed and the account suspended. Decisions by arcade
          staff are final.
        </Section>

        <Section title="Termination">
          We may suspend or terminate your account at our discretion for violations of these
          terms. You may delete your account at any time via Profile → Delete Account.
        </Section>

        <Section title="Disclaimer of Warranties">
          The app is provided "as is" without warranties of any kind. We do not guarantee
          uptime, accuracy of scores or leaderboards, or uninterrupted service.
        </Section>

        <Section title="Limitation of Liability">
          To the fullest extent permitted by law, ArcadeTracker is not liable for indirect,
          incidental, or consequential damages arising from your use of the service.
        </Section>

        <Section title="Changes">
          We may update these terms at any time. Continued use after notice of changes
          constitutes acceptance of the updated terms.
        </Section>

        <Section title="Contact">
          {"Questions about these terms? Contact us at:\n\nsupport@arcadetracker.app"}
        </Section>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.sectionBody}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#111", alignItems: "center", justifyContent: "center",
  },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  content: { paddingHorizontal: 22, paddingTop: 20 },
  updated: { color: "#444", fontSize: 12, marginBottom: 24 },
  section: { marginBottom: 28 },
  sectionTitle: { color: "#fff", fontSize: 16, fontWeight: "800", marginBottom: 10 },
  sectionBody: { color: "#888", fontSize: 14, lineHeight: 22 },
});
