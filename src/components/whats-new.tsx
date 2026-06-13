import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

// Bump the version whenever the list changes — the sheet shows once per version.
const WHATS_NEW_VERSION = "2026-06-12";

const ITEMS: { icon: string; color: string; title: string; body: string }[] = [
  { icon: "flag", color: "#ef4444", title: "Report & block", body: "Report any post, comment, or profile. Block users to hide their content." },
  { icon: "sparkles", color: "#a855f7", title: "Weekly Pick'em", body: "Predict Monday's top team before games start. Predictors leaderboard included." },
  { icon: "trophy", color: "#f59e0b", title: "Hall of Fame", body: "All-time league records — highest game, hundo streaks, and more." },
  { icon: "calendar", color: "#22c55e", title: "RSVP & subs", body: "Mark yourself In/Out for Monday on your team page. Need a sub? One tap." },
  { icon: "happy", color: "#06b6d4", title: "Reactions, polls & mentions", body: "React with emojis, run polls in forums, and @mention friends." },
  { icon: "notifications", color: "#06b6d4", title: "Notifications inbox", body: "Invites, requests, results, and announcements — all in one place (bell icon)." },
];

const KEY = "whats_new_seen";

/** One-time "What's New" sheet after an update. Render once on the feed. */
export function WhatsNewSheet() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((seen) => {
      if (seen !== WHATS_NEW_VERSION) setVisible(true);
    }).catch(() => {});
  }, []);

  function dismiss() {
    AsyncStorage.setItem(KEY, WHATS_NEW_VERSION).catch(() => {});
    setVisible(false);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
      <View style={s.bg}>
        <Pressable style={s.dismissArea} onPress={dismiss} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.heading}>✨ What's New</Text>
          <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
            {ITEMS.map((it) => (
              <View key={it.title} style={s.row}>
                <View style={[s.iconWrap, { backgroundColor: `${it.color}14`, borderColor: `${it.color}30` }]}>
                  <Ionicons name={it.icon as any} size={17} color={it.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.title}>{it.title}</Text>
                  <Text style={s.body}>{it.body}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <Pressable style={s.btn} onPress={dismiss}>
            <Text style={s.btnText}>Let's go</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: "rgba(0,0,0,0.78)", justifyContent: "flex-end" },
  dismissArea: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 22, paddingTop: 14, paddingBottom: 34,
    borderTopWidth: 1, borderColor: "#1a1a1a",
    width: "100%", maxWidth: 560, alignSelf: "center",
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 14 },
  heading: { color: "#fff", fontSize: 20, fontWeight: "900", textAlign: "center", marginBottom: 14 },
  row: { flexDirection: "row", gap: 13, paddingVertical: 10, alignItems: "flex-start" },
  iconWrap: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontSize: 14.5, fontWeight: "800", marginBottom: 2 },
  body: { color: "#999", fontSize: 13, lineHeight: 18 },
  btn: { backgroundColor: "#06b6d4", borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 12 },
  btnText: { color: "#000", fontSize: 15, fontWeight: "900" },
});
