import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function PrivacyScreen() {
  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Text style={s.updated}>Last updated: June 2025</Text>

        <Section title="Overview">
          ArcadeTracker ("we", "us") operates the ArcadeTracker mobile application. This policy
          explains what data we collect, how we use it, and the choices you have.
        </Section>

        <Section title="Information We Collect">
          {"• "}
          <Text style={s.bold}>Account data</Text>
          {" — email address, username, and optional profile photo when you register.\n\n• "}
          <Text style={s.bold}>Usage data</Text>
          {" — scores you submit, games you check in to, posts you create, teams you join, and tournament activity.\n\n• "}
          <Text style={s.bold}>Photos</Text>
          {" — images you voluntarily attach to score submissions or posts. These are stored in our cloud storage.\n\n• "}
          <Text style={s.bold}>Device data</Text>
          {" — standard log data (IP address, device type, OS version) collected automatically for security and debugging."}
        </Section>

        <Section title="How We Use Your Data">
          {"• Provide and improve the app's features.\n• Display your username and scores on leaderboards and feeds visible to other users.\n• Send in-app notifications about tournaments, team activity, and score reviews.\n• Detect abuse, fraud, and security threats.\n• Comply with legal obligations."}
        </Section>

        <Section title="Data Sharing">
          We do not sell your personal data. We may share data with:
          {"\n\n• "}
          <Text style={s.bold}>Supabase</Text>
          {" — our database and authentication provider (SOC 2 compliant).\n• "}
          <Text style={s.bold}>Law enforcement</Text>
          {" — when required by law or to protect user safety."}
        </Section>

        <Section title="User-Generated Content">
          Posts, scores, and profile information you share are visible to other authenticated
          users of the app. You can delete your own posts at any time. Deleting a post removes
          it from the feed but may not immediately remove it from cached devices.
        </Section>

        <Section title="Data Retention">
          We retain your data for as long as your account is active. You can request deletion
          of your account and all associated data at any time — see the "Delete Account"
          section in your Profile settings or visit the Delete Account screen in the app.
        </Section>

        <Section title="Children">
          ArcadeTracker is not directed at children under 13. We do not knowingly collect
          personal data from children under 13. If you believe we have inadvertently done so,
          contact us and we will delete the data promptly.
        </Section>

        <Section title="Your Rights">
          Depending on your location you may have the right to access, correct, or delete
          your personal data. To exercise these rights, use the in-app Delete Account feature
          or contact us at the address below.
        </Section>

        <Section title="Changes to This Policy">
          We may update this policy periodically. We will notify you of material changes
          via an in-app notice. Continued use after notice constitutes acceptance.
        </Section>

        <Section title="Contact">
          {"Questions? Reach us at:\n\nsupport@arcadetracker.app"}
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
  bold: { color: "#ccc", fontWeight: "700" },
});
