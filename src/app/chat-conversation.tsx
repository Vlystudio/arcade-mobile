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
  sender_id: string;
  content: string;
  created_at: string;
};

export default function ChatConversationScreen() {
  const { conversationId, otherUsername, otherAvatarUrl } = useLocalSearchParams<{ conversationId: string; otherUsername: string; otherAvatarUrl: string }>();
  const { user, loading: authLoading } = useRequireAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  async function loadMessages() {
    if (!conversationId) return;
    const { data } = await supabase
      .from("messages")
      .select("id, sender_id, content, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    setMessages(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (!user || !conversationId) return;

    loadMessages();

    // Real-time subscription
    const channel = supabase
      .channel(`conv:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, conversationId]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [loading]);

  async function sendMessage() {
    if (!text.trim() || !user || !conversationId || sending) return;
    const content = text.trim();
    setText("");
    setSending(true);

    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content,
    });

    if (!error) {
      // Update last_message on conversation
      await supabase
        .from("conversations")
        .update({ last_message: content, last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
    }

    setSending(false);
  }

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}>

        {/* Custom header */}
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/chat" as any)}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Avatar uri={otherAvatarUrl || null} name={otherUsername ?? "?"} size={36} />
          <Text style={styles.headerName}>{otherUsername ?? "Chat"}</Text>
        </View>

        {/* Messages */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatText}>No messages yet. Say hello!</Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const isMe = item.sender_id === user?.id;
            const prevMsg = index > 0 ? messages[index - 1] : null;
            const showTime = !prevMsg || (new Date(item.created_at).getTime() - new Date(prevMsg.created_at).getTime()) > 5 * 60 * 1000;

            return (
              <>
                {showTime && (
                  <Text style={styles.timestamp}>{fmtTime(item.created_at)}</Text>
                )}
                <View style={[styles.bubbleWrap, isMe && styles.bubbleWrapMe]}>
                  <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                    <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.content}</Text>
                  </View>
                </View>
              </>
            );
          }}
        />

        {/* Input */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Message…"
            placeholderTextColor="#333"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={1000}
            returnKeyType="default"
          />
          <Pressable
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnOff]}
            onPress={sendMessage}
            disabled={!text.trim() || sending}
          >
            <Ionicons name="arrow-up" size={18} color={text.trim() ? "#000" : "#333"} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  root: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
    backgroundColor: "#000",
  },
  backBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#1c1c1c", alignItems: "center", justifyContent: "center" },
  headerAvatarText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  headerName: { color: "#fff", fontSize: 16, fontWeight: "800" },

  messageList: { paddingHorizontal: 16, paddingVertical: 12, gap: 2 },

  emptyChat: { paddingTop: 80, alignItems: "center" },
  emptyChatText: { color: "#444", fontSize: 14 },

  timestamp: { color: "#444", fontSize: 11, textAlign: "center", marginVertical: 12 },

  bubbleWrap: { flexDirection: "row", marginBottom: 3 },
  bubbleWrapMe: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "72%", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10,
  },
  bubbleMe: { backgroundColor: "#06b6d4", borderBottomRightRadius: 5 },
  bubbleThem: { backgroundColor: "#1c1c1c", borderBottomLeftRadius: 5 },
  bubbleText: { color: "#e0e0e0", fontSize: 15, lineHeight: 21 },
  bubbleTextMe: { color: "#000" },

  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a",
    backgroundColor: "#000",
  },
  input: {
    flex: 1, color: "#fff", fontSize: 15, lineHeight: 21,
    backgroundColor: "#111", borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: "#222", maxHeight: 120,
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
  },
  sendBtnOff: { backgroundColor: "#111" },
});
