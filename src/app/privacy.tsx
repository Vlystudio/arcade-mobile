import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Head from "expo-router/head";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function PrivacyScreen() {
  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <Head>
        <title>Privacy Policy · ArcadeTracker</title>
        <meta name="description" content="ArcadeTracker privacy policy — what we collect, how we protect it, and your rights." />
      </Head>
      <View style={s.header}>
        <Pressable style={s.backBtn} hitSlop={10} onPress={() => router.canGoBack() ? router.back() : router.replace("/welcome" as any)}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Text style={s.updated}>Last updated: June 2026</Text>

        <Section title="Overview">
          ArcadeTracker ("we", "us", "our") operates the ArcadeTracker mobile application. This
          Privacy Policy explains what personal information we collect, how we use and protect it,
          and the rights you have regarding your data. ArcadeTracker is a 21+ venue-connected
          platform; we take your privacy and security seriously.
        </Section>

        <Section title="Information We Collect">
          <Text style={s.bold}>Account & Profile Data</Text>
          {"\nWhen you register, we collect your email address, username, and optional profile " +
           "photo and bio. You may also add a featured game preference.\n\n"}
          <Text style={s.bold}>Gameplay & Activity Data</Text>
          {"\nWe collect scores you submit, games you check in to, tournament participation, " +
           "team membership, leagues joined, posts you create, and interactions with other " +
           "users' content.\n\n"}
          <Text style={s.bold}>Photos & Media</Text>
          {"\nImages you attach to score submissions, posts, or your profile are stored in our " +
           "private cloud storage. Score proof images are stored in a private bucket and are " +
           "only accessible via time-limited signed URLs to the submitting user and authorized " +
           "venue staff.\n\n"}
          <Text style={s.bold}>Location & Venue Data</Text>
          {"\nWhen you check in to a lane via QR code or manual selection, we record the venue " +
           "and lane associated with that session.\n\n"}
          <Text style={s.bold}>Device & Technical Data</Text>
          {"\nWe collect standard technical data including device type, operating system version, " +
           "app version, and IP address. This data is used for security monitoring, debugging, " +
           "and service improvement.\n\n"}
          <Text style={s.bold}>Security & Audit Data</Text>
          {"\nWe maintain internal logs of security-relevant events (such as failed login attempts, " +
           "QR token usage, and rate limit breaches) and administrator audit logs (recording " +
           "all administrative actions taken on the platform). These logs are not shared publicly."}
        </Section>

        <Section title="How We Use Your Data">
          {"• To provide, operate, and improve the App and its features.\n" +
           "• To display your username, scores, and activity on leaderboards and community " +
           "feeds visible to other authenticated users.\n" +
           "• To send you in-app notifications about tournaments, team activity, score reviews, " +
           "and important account updates.\n" +
           "• To verify score submissions and maintain leaderboard integrity.\n" +
           "• To detect, investigate, and prevent abuse, fraud, cheating, and security threats.\n" +
           "• To enforce our Terms of Service and Community Standards.\n" +
           "• To respond to your support requests and feedback.\n" +
           "• To comply with applicable legal obligations."}
        </Section>

        <Section title="Content Moderation">
          {"To enforce our Community Standards, uploaded images and text content are processed " +
           "by automated moderation systems:\n\n"}
          <Text style={s.bold}>Image Moderation (AWS Rekognition)</Text>
          {"\nImages you upload are analyzed by Amazon Rekognition, a machine-learning service, " +
           "to detect prohibited content such as nudity, violence, and hate symbols. Images are " +
           "transmitted to AWS for analysis and are not retained by AWS after analysis completes. " +
           "AWS processes this data subject to the AWS Privacy Notice.\n\n"}
          <Text style={s.bold}>Text Moderation (OpenAI)</Text>
          {"\nText content including posts, bios, and submitted text may be analyzed by OpenAI's " +
           "moderation API to identify hate speech, harassment, and other prohibited content. " +
           "Text is transmitted to OpenAI solely for moderation purposes. OpenAI processes this " +
           "data subject to their Privacy Policy and API usage terms."}
        </Section>

        <Section title="Crash Reporting & Performance">
          {"We use Sentry (sentry.io) for crash reporting and performance monitoring. Sentry " +
           "automatically collects crash reports, stack traces, device information, and — with " +
           "your consent — session replay data when errors occur. This data is used solely to " +
           "identify and fix bugs. Sentry processes this data subject to their Privacy Policy. " +
           "We have configured Sentry to capture replays on error at a 100% rate and during " +
           "normal sessions at a 10% sample rate."}
        </Section>

        <Section title="Rate Limiting">
          {"To protect the App from abuse and ensure fair access, API request rates are tracked " +
           "using Upstash Redis (upstash.com). Upstash stores request counts keyed to your user " +
           "identifier for short-duration windows (typically 1 minute to 1 hour). No message " +
           "content is stored in the rate limiting system — only request frequency counts."}
        </Section>

        <Section title="Private Messages (End-to-End Encryption)">
          {"Direct messages between users are end-to-end encrypted (E2EE) using a public-key " +
           "cryptography system. Your messages are encrypted on your device before being " +
           "transmitted and can only be decrypted by the intended recipient. ArcadeTracker staff " +
           "cannot read the content of private messages.\n\n" +
           "Message metadata — such as the fact that a conversation exists between two users " +
           "and message timestamps — is stored in our database and is accessible to platform " +
           "administrators for safety and abuse investigation purposes."}
        </Section>

        <Section title="Two-Factor Authentication (MFA)">
          {"When you enable two-factor authentication, we store a cryptographic verification " +
           "key associated with your authenticator app. We do not store one-time passcodes (TOTPs). " +
           "Admin-level actions in the platform require MFA (AAL2 authentication assurance level) " +
           "to reduce the risk of compromised accounts performing privileged operations."}
        </Section>

        <Section title="Data Sharing">
          {"We do not sell your personal data. We share data only as follows:\n\n"}
          <Text style={s.bold}>Service Providers</Text>
          {"\nWe share data with trusted third-party providers who process it on our behalf:\n" +
           "• Supabase — database, authentication, and storage (SOC 2 Type II certified)\n" +
           "• Amazon Web Services (AWS) — image moderation via Rekognition\n" +
           "• OpenAI — text content moderation\n" +
           "• Sentry — crash reporting and performance monitoring\n" +
           "• Upstash — API rate limiting\n" +
           "• Vercel — API hosting and edge functions\n\n"}
          <Text style={s.bold}>Legal Compliance</Text>
          {"\nWe may disclose data to law enforcement or regulatory authorities when required " +
           "by applicable law, court order, or to protect the safety of our users or the public.\n\n"}
          <Text style={s.bold}>Business Transfers</Text>
          {"\nIn the event of a merger, acquisition, or sale of all or substantially all of our " +
           "assets, user data may be transferred to the acquiring entity."}
        </Section>

        <Section title="User-Generated Content">
          Posts, scores, profile information, and team content you share are visible to other
          authenticated users of the App. You can delete your own posts and profile content at
          any time through the App. Deletion removes content from active display; residual copies
          in backup systems are purged on a rolling schedule.
        </Section>

        <Section title="Data Retention">
          {"We retain your account and activity data for as long as your account is active. " +
           "If you delete your account:\n\n" +
           "• Your profile is anonymized immediately.\n" +
           "• Your posts and public content are deleted.\n" +
           "• Uploaded files (avatar, photos, score proofs) are queued for deletion.\n" +
           "• Security and audit logs referencing your account are retained for up to 90 days " +
           "for fraud and abuse investigation purposes.\n" +
           "• Anonymized, aggregated statistical data (e.g., total score counts) may be " +
           "retained indefinitely."}
        </Section>

        <Section title="Your Rights">
          {"Depending on your jurisdiction, you may have rights to:\n\n" +
           "• Access the personal data we hold about you.\n" +
           "• Correct inaccurate personal data.\n" +
           "• Delete your account and associated personal data.\n" +
           "• Object to or restrict certain processing of your data.\n" +
           "• Data portability (receive a copy of your data in a machine-readable format).\n\n" +
           "To exercise these rights, use the Delete Account feature in your Profile settings " +
           "or contact us at the address below."}
        </Section>

        <Section title="Children">
          ArcadeTracker is exclusively for users aged 21 and older. We do not knowingly collect
          personal data from individuals under 21. If we become aware that an account was created
          by someone under 21, we will immediately delete that account and all associated data.
        </Section>

        <Section title="Security">
          {"We implement industry-standard security measures to protect your data, including:\n\n" +
           "• All data in transit is encrypted via TLS 1.2+.\n" +
           "• Database data is encrypted at rest.\n" +
           "• Row-Level Security (RLS) policies ensure users can only access their own data.\n" +
           "• Score proof images are stored in private storage buckets accessible only via " +
           "time-limited signed URLs.\n" +
           "• QR check-in tokens are stored as one-way cryptographic hashes — raw tokens are " +
           "never persisted.\n" +
           "• Administrator accounts require multi-factor authentication (MFA) for privileged " +
           "operations.\n" +
           "• Automated rate limiting protects all API endpoints against abuse."}
        </Section>

        <Section title="Changes to This Policy">
          We may update this Privacy Policy periodically to reflect changes in our practices or
          applicable law. We will notify you of material changes via an in-app notice. Continued
          use of the App after notice constitutes acceptance of the updated policy.
        </Section>

        <Section title="Contact">
          {"Questions or concerns about this Privacy Policy? Contact us at:\n\n" +
           "support@arcadetracker.app\n\n" +
           "Or use the Support Chat feature available from your Profile."}
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
  updated: { color: "#777", fontSize: 12, marginBottom: 24 },
  section: { marginBottom: 28 },
  sectionTitle: { color: "#fff", fontSize: 15, fontWeight: "800", marginBottom: 10 },
  sectionBody: { color: "#888", fontSize: 14, lineHeight: 22 },
  bold: { color: "#ccc", fontWeight: "700" },
});
