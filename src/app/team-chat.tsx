import { Avatar } from "../components/avatar";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useRequireAuth } from "../hooks/use-require-auth";

type Message = {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  content: string;
  created_at: string;
};

export default function TeamChatScreen() {
  const { teamId, teamName } = useLocalSearchParams<{ teamId: string; teamName: string }>();
  const { user } = useRequireAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [profileMap, setProfileMap] = useState<Record<string, { username: string; avatar_url: string | null }>>({});
  const listRef = useRef<FlatList>(null);

  async function loadMessages() {
    if (!teamId) return;
    const { data } = await supabase
      .from("team_messages")
      .select("id, user_id, content, created_at")
      .eq("team_id", teamId)
      .order("created_at", { ascending: true })
      .limit(100);

    const rows = data ?? [];
    const userIds = [...new Set(rows.map((r: any) => r.user_id as string))];
    let map: Record<string, { username: string; avatar_url: string | null }> = {};
    if (userIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, username, avatar_url").in("id", userIds);
      for (const p of profiles ?? []) map[(p as any).id] = { username: (p as any).username, avatar_url: (p as any).avatar_url };
    }
    setProfileMap(map);
    setMessages(rows.map((r: any) => ({
      id: r.id, user_id: r.user_id,
      username: map[r.user_id]?.username ?? "Unknown",
      avatar_url: map[r.user_id]?.avatar_url ?? null,
      content: r.content, created_at: r.created_at,
    })));
    setLoading(false);
  }

  useEffect(() => {
    if (!user || !teamId) return;
    loadMessages();

    const channel = supabase
      .channel(`team-chat-${teamId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "team_messages",
        filter: `team_id=eq.${teamId}`,
      }, async (payload) => {
        const r = payload.new as any;
        let profile = profileMap[r.user_id];
        if (!profile) {
          const { data } = await supabase.from("profiles").select("username, avatar_url").eq("id", r.user_id).single();
          profile = { username: (data as any)?.username ?? "Unknown", avatar_url: (data as any)?.avatar_url ?? null };
          setProfileMap((prev) => ({ ...prev, [r.user_id]: profile }));
        }
        setMessages((prev) => [...prev, {
          id: r.id, user_id: r.user_id,
          username: profile.username, avatar_url: profile.avatar_url,
          content: r.content, created_at: r.created_at,
        }]);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, teamId]);

  async function sendMessage() {
    if (!user || !teamId || !draft.trim()) return;
    setSending(true);
    await supabase.from("team_messages").insert({ team_id: teamId, user_id: user.id, content: draft.trim() });
    setDraft("");
    setSending(false);
  }

  function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  function fmtDay(iso: string) {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // Group messages by day
  const grouped: Array<{ type: "date"; label: string } | { type: "msg"; msg: Message }> = [];
  let lastDay = "";
  for (const msg of messages) {
    const day = new Date(msg.created_at).toDateString();
    if (day !== lastDay) { grouped.push({ type: "date", label: fmtDay(msg.created_at) }); lastDay = day; }
    grouped.push({ type: "msg", msg });
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/teams" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{teamName ?? "Team Chat"}</Text>
          <Text style={styles.headerSub}>Team Chat</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }} keyboardVerticalOffset={0}>
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#06b6d4" />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={grouped}
            keyExtractor={(item, i) => item.type === "date" ? `date-${i}` : item.msg.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => {
              if (item.type === "date") {
                return (
                  <View style={styles.dateSep}>
                    <View style={styles.dateLine} />
                    <Text style={styles.dateLabel}>{item.label}</Text>
                    <View style={styles.dateLine} />
                  </View>
                );
              }
              const msg = item.msg;
              const isMe = msg.user_id === user?.id;
              return (
                <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
                  {!isMe && <Avatar uri={msg.avatar_url} name={msg.username} size={34} radius={10} />}
                  <View style={[styles.bubble, isMe && styles.bubbleMe]}>
                    {!isMe && <Text style={styles.bubbleName}>{msg.username}</Text>}
                    <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{msg.content}</Text>
                    <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>{fmtTime(msg.created_at)}</Text>
                  </View>
                </View>
              );
            }}
          />
        )}

        {/* Input */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Message…"
            placeholderTextColor="#444"
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={500}
            returnKeyType="default"
          />
          <Pressable
            style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]}
            onPress={sendMessage}
            disabled={!draft.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color="#000" />
              : <Ionicons name="send" size={18} color="#000" />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },
  headerSub: { color: "#444", fontSize: 12 },

  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  list: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },

  dateSep: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 16 },
  dateLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: "#1e1e1e" },
  dateLabel: { color: "#333", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },

  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 6 },
  msgRowMe: { flexDirection: "row-reverse" },

  bubble: {
    maxWidth: "75%", backgroundColor: "#1a1a1a",
    borderRadius: 18, borderBottomLeftRadius: 5,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: "#2a2a2a",
  },
  bubbleMe: { backgroundColor: "#06b6d4", borderBottomLeftRadius: 18, borderBottomRightRadius: 5, borderColor: "transparent" },
  bubbleName: { color: "#06b6d4", fontSize: 11, fontWeight: "800", marginBottom: 3 },
  bubbleText: { color: "#e0e0e0", fontSize: 14, lineHeight: 20 },
  bubbleTextMe: { color: "#000" },
  bubbleTime: { color: "#444", fontSize: 10, marginTop: 4, textAlign: "right" },
  bubbleTimeMe: { color: "rgba(0,0,0,0.45)" },

  inputRow: {
    flexDirection: "row", alignItems: "flex-end", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a",
    backgroundColor: "#000",
  },
  input: {
    flex: 1, backgroundColor: "#111",
    borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11,
    color: "#fff", fontSize: 15, lineHeight: 20,
    maxHeight: 120,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#06b6d4",
    alignItems: "center", justifyContent: "center",
  },
});
