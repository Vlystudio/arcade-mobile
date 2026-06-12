import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Head from "expo-router/head";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export const CURRENT_TOS_VERSION = "2026-06.3";

export default function TermsScreen() {
  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <Head>
        <title>Terms of Service · ArcadeTracker</title>
        <meta name="description" content="ArcadeTracker terms of service." />
      </Head>
      <View style={s.header}>
        <Pressable style={s.backBtn} hitSlop={10} onPress={() => router.canGoBack() ? router.back() : router.replace("/welcome" as any)}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>Terms of Service</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        <Text style={s.updated}>Last updated: June 2026 · Version {CURRENT_TOS_VERSION}</Text>

        <Section title="1. Agreement to Terms">
          By downloading, installing, or using ArcadeTracker ("the App", "we", "us", "our")
          you agree to be bound by these Terms of Service and all applicable laws. If you do
          not agree to all of these terms, do not use the App.
        </Section>

        <Section title="2. Age Requirement">
          {"ArcadeTracker is intended for users aged 21 and older. You must be at least 21 years " +
           "of age to create an account or use the App. By creating an account you represent and " +
           "warrant that you are 21 years of age or older.\n\n" +
           "If we discover that an account was created by someone under 21, the account will be " +
           "immediately and permanently deleted without notice."}
        </Section>

        <Section title="3. Your Account">
          {"• You are solely responsible for maintaining the confidentiality of your login " +
           "credentials and for all activity that occurs under your account.\n" +
           "• Do not share your account with any other person.\n" +
           "• You must notify us immediately if you suspect any unauthorized use of your account.\n" +
           "• You may not create more than one account. Duplicate accounts will be terminated.\n" +
           "• Impersonating another user, staff member, or venue employee is strictly prohibited."}
        </Section>

        <Section title="4. Community Standards">
          {"ArcadeTracker is a community platform. All content you post publicly — including " +
           "profile photos, bio text, posts, team names, " +
           "score submissions, and chat messages visible to other users — must comply with the " +
           "following standards.\n\n" +
           "PROHIBITED CONTENT\n\n" +
           "The following content is strictly prohibited on ArcadeTracker:\n\n" +
           "• Nudity, sexually explicit or suggestive content, or pornography of any kind.\n" +
           "• Profanity, obscene language, or sexually explicit text directed at or visible to " +
           "other users.\n" +
           "• Racist, white-supremacist, antisemitic, or other hate-based content targeting any " +
           "race, ethnicity, or national origin.\n" +
           "• Homophobic, transphobic, or any content that demeans or dehumanizes individuals " +
           "based on sexual orientation or gender identity.\n" +
           "• Hate speech: any content that promotes violence or hatred against individuals or " +
           "groups based on religion, disability, sex, or any other protected characteristic.\n" +
           "• Gore, graphic violence, dismemberment, or images of serious injury or death.\n" +
           "• Images of blood or violent photographs of any kind.\n" +
           "• Harassment, threats, or targeted intimidation of any user or staff member.\n" +
           "• Content that glorifies or promotes drug use, illegal firearms, or criminal activity.\n" +
           "• Spam, phishing links, scam content, or unsolicited commercial promotions.\n" +
           "• Content that violates any third party's intellectual property rights.\n\n" +
           "Content moderation is performed by both automated systems and human review. " +
           "Prohibited content will be removed without notice."}
        </Section>

        <Section title="5. Private Messages">
          {"Direct messages are private to the participants in the conversation: they are protected with industry-standard encryption in transit and at rest, and no other user can read them. ArcadeTracker staff do not read private messages in the normal course of operating the App; message content may be accessed only when required to investigate reported abuse, enforce these Terms, or comply with legal obligations.\n\nDo not share prohibited content in private messages. Doing so violates these Terms of Service and may result in account suspension if reported and verified."}
        </Section>

        <Section title="6. User Content License">
          {"You retain ownership of all content you create and post on ArcadeTracker " +
           "(\"User Content\"). By posting User Content, you grant ArcadeTracker a non-exclusive, " +
           "royalty-free, worldwide, transferable license to host, store, display, reproduce, " +
           "and distribute that content solely for the purpose of operating and improving the App.\n\n" +
           "This license ends when you delete your content or your account. You are responsible " +
           "for ensuring you have all necessary rights to any content you upload."}
        </Section>

        <Section title="7. Score Integrity">
          {"Scores submitted on ArcadeTracker are subject to review by venue staff and platform " +
           "administrators. By submitting a score, you represent that:\n\n" +
           "• The score was achieved legitimately by you on the indicated machine.\n" +
           "• Any photo or video evidence submitted is authentic and unedited.\n" +
           "• The score was not achieved through any exploit, cheat, or external assistance.\n\n" +
           "Scores found to be falsified or submitted with fabricated evidence will be removed. " +
           "Repeated violations will result in account suspension or permanent ban. All " +
           "administrative decisions regarding score integrity are final."}
        </Section>

        <Section title="8. Enforcement & Account Suspension">
          {"Violations of these Terms of Service are subject to enforcement action, which " +
           "may include any of the following at our sole discretion:\n\n" +
           "• A formal warning issued to your account.\n" +
           "• Temporary suspension (ranging from 24 hours to 30 days depending on severity).\n" +
           "• Permanent deletion of your account and all associated data.\n\n" +
           "Severe violations — including posting child sexual abuse material (CSAM), issuing " +
           "credible threats of violence, or engaging in targeted harassment campaigns — will " +
           "result in immediate permanent account deletion and may be reported to law enforcement.\n\n" +
           "We reserve the right to suspend or terminate any account at our sole discretion " +
           "for any violation of these terms, or for conduct that we determine to be harmful " +
           "to our community, even if not explicitly listed above."}
        </Section>

        <Section title="9. Intellectual Property">
          {"All rights, title, and interest in the ArcadeTracker platform — including its " +
           "design, software, brand, logos, and features — are owned by or licensed to " +
           "ArcadeTracker. These terms do not grant you any right to use our trademarks, " +
           "logos, or brand features without prior written consent."}
        </Section>

        <Section title="10. Disclaimer of Warranties">
          {"THE APP IS PROVIDED \"AS IS\" AND \"AS AVAILABLE\" WITHOUT WARRANTIES OF ANY KIND, " +
           "EITHER EXPRESS OR IMPLIED. WE DISCLAIM ALL WARRANTIES INCLUDING, BUT NOT LIMITED " +
           "TO, IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND " +
           "NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE APP WILL BE UNINTERRUPTED, ERROR-FREE, " +
           "OR FREE OF VIRUSES OR OTHER HARMFUL COMPONENTS."}
        </Section>

        <Section title="11. Limitation of Liability">
          {"TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, ARCADETRACKER AND ITS OFFICERS, " +
           "DIRECTORS, EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, " +
           "SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES — INCLUDING LOSS OF PROFITS, DATA, OR " +
           "GOODWILL — ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE APP, EVEN IF WE " +
           "HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.\n\n" +
           "IN NO EVENT SHALL OUR TOTAL LIABILITY TO YOU EXCEED THE GREATER OF $50 OR THE " +
           "AMOUNT YOU PAID US IN THE PRECEDING 12 MONTHS."}
        </Section>

        <Section title="12. Indemnification">
          You agree to indemnify, defend, and hold harmless ArcadeTracker and its affiliates,
          officers, directors, employees, and agents from and against any claims, liabilities,
          damages, losses, and expenses — including reasonable attorneys' fees — arising out of
          or in any way connected with your use of the App, your User Content, or your violation
          of these Terms.
        </Section>

        <Section title="13. Governing Law">
          These Terms are governed by the laws of the state in which ArcadeTracker's principal
          place of business is located, without regard to its conflict of law provisions. Any
          disputes arising under these Terms shall be resolved in the courts of that jurisdiction.
        </Section>

        <Section title="14. Changes to These Terms">
          {"We may update these Terms at any time. When we make material changes, we will " +
           "notify you through the App and require you to affirmatively accept the updated " +
           "Terms before continuing to use the service. Your continued use after accepting " +
           "updated Terms constitutes your agreement to be bound by them."}
        </Section>

        <Section title="15. YouTube Content & API Services">
          {"The karaoke feature uses YouTube API Services to let you search for and queue publicly available YouTube videos. By using this feature, you agree to be bound by the YouTube Terms of Service (youtube.com/t/terms), and you acknowledge that Google's Privacy Policy (policies.google.com/privacy) applies to data processed by YouTube.\n\nVideo search results, titles, thumbnails, and channel names are provided by YouTube. Playback occurs only through the official embedded YouTube player, which we do not hide, alter, or overlay. ArcadeTracker does not download, re-host, separate audio or video from, or store YouTube content, and does not play YouTube content in the background.\n\nArcadeTracker is not affiliated with or endorsed by YouTube or Google."}
        </Section>

        <Section title="16. Contact Us">
          {"Questions about these Terms of Service? Contact us at:\n\nvaleyardvisuals@vlystudios.com\n\n" +
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
});
