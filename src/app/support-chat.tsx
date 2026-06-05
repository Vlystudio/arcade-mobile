import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
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

import { API_BASE } from "../../lib/api-base";

type SupportMessage = {
  id: string;
  content: string;
  is_admin_msg: boolean;
  created_at: string;
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function SupportChatScreen() {
  const { user } = useRequireAuth();

  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [text, setText]           = useState("");
  const [sending, setSending]     = useState(false);
  const [loading, setLoading]     = useState(true);
  const [emailSent, setEmailSent] = useState(false);
  const listRef = useRef<FlatList<SupportMessage>>(null);

  // Load existing open ticket and its messages
  useEffect(() => {
    if (!user) return;
    let mounted = true;

    async function load() {
      const { data: ticket } = await supabase
        .from("support_tickets")
        .select("id")
        .eq("user_id", user!.id)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!mounted) return;

      if (ticket) {
        setTicketId(ticket.id);
        const { data: msgs } = await supabase
          .from("support_messages")
          .select("id, content, is_admin_msg, created_at")
          .eq("ticket_id", ticket.id)
          .order("created_at", { ascending: true });
        if (mounted) setMessages(msgs ?? []);
      }

      if (mounted) setLoading(false);
    }

    load();
    return () => { mounted = false; };
  }, [user]);

  // Realtime subscription for new messages
  useEffect(() => {
    if (!ticketId) return;

    const channel = supabase
      .channel(`support-ticket-${ticketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "support_messages",
          filter: `ticket_id=eq.${ticketId}`,
        },
        (payload) => {
          const raw = payload.new as any;
          const msg: SupportMessage = {
            id:           raw.id,
            content:      raw.content,
            is_admin_msg: raw.is_admin_msg,
            created_at:   raw.created_at,
          };
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [ticketId]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText("");

    const { data, error } = await supabase.rpc("rpc_send_support_message", {
      p_content: trimmed,
    });

    if (error || (data as any)?.error) {
      setText(trimmed);
      setSending(false);
      return;
    }

    const result = data as { ticket_id: string; message_id: string; admin_online: boolean };

    // Set ticket ID so realtime subscription activates
    if (!ticketId) setTicketId(result.ticket_id);

    // Notify on first message of the session
    if (!emailSent) {
      setEmailSent(true);
      try {
        const { data: { session: s } } = await supabase.auth.getSession();
        await fetch(`${API_BASE}/api/support-notify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${s?.access_token ?? ""}`,
          },
          body: JSON.stringify({ ticketId: result.ticket_id }),
        });
      } catch {
        // Non-fatal — ticket is already saved
      }
    }

    // Reload messages for this ticket if this was the first message
    if (!ticketId) {
      const { data: msgs } = await supabase
        .from("support_messages")
        .select("id, content, is_admin_msg, created_at")
        .eq("ticket_id", result.ticket_id)
        .order("created_at", { ascending: true });
      setMessages(msgs ?? []);
    }

    setSending(false);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }

  if (loading) {
    return (
      <SafeAreaView style={s.root} edges={["top", "bottom"]}>
        <View style={s.header}>
          <Pressable style={s.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <Text style={s.headerTitle}>Support</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.loader}>
          <ActivityIndicator color="#06b6d4" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Support</Text>
          <Text style={s.headerSub}>ArcadeTracker Team</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          contentContainerStyle={s.messageList}
          onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
          ListHeaderComponent={
            <View style={s.welcomeBanner}>
              <View style={s.welcomeIcon}>
                <Ionicons name="headset-outline" size={28} color="#06b6d4" />
              </View>
              <Text style={s.welcomeTitle}>How can we help?</Text>
              <Text style={s.welcomeSub}>
                Messages go directly to our team. If no one is available, you'll receive a response
                by email. We typically reply within a few hours.
              </Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const isMe = !item.is_admin_msg;
            const prevMsg = messages[index - 1];
            const showDate = !prevMsg || formatDate(item.created_at) !== formatDate(prevMsg.created_at);

            return (
              <>
                {showDate && (
                  <View style={s.dateSep}>
                    <Text style={s.dateSepText}>{formatDate(item.created_at)}</Text>
                  </View>
                )}
                <View style={[s.msgRow, isMe ? s.msgRowMe : s.msgRowThem]}>
                  {!isMe && (
                    <View style={s.adminAvatar}>
                      <Ionicons name="shield-checkmark" size={14} color="#06b6d4" />
                    </View>
                  )}
                  <View style={[s.bubble, isMe ? s.bubbleMe : s.bubbleThem]}>
                    {!isMe && <Text style={s.adminLabel}>ArcadeTracker Support</Text>}
                    <Text style={[s.bubbleText, isMe ? s.bubbleTextMe : s.bubbleTextThem]}>
                      {item.content}
                    </Text>
                    <Text style={[s.bubbleTime, isMe ? s.bubbleTimeMe : s.bubbleTimeThem]}>
                      {formatTime(item.created_at)}
                    </Text>
                  </View>
                </View>
              </>
            );
          }}
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Ionicons name="chatbubbles-outline" size={36} color="#222" />
              <Text style={s.emptyText}>Send a message to get started</Text>
            </View>
          }
        />

        {emailSent && (
          <View style={s.offlineBanner}>
            <Ionicons name="mail-outline" size={15} color="#f59e0b" />
            <Text style={s.offlineBannerText}>
              No staff online — an urgent email has been sent. We'll reply soon.
            </Text>
          </View>
        )}

        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            placeholder="Type a message…"
            placeholderTextColor="#333"
            value={text}
            onChangeText={setText}
            multiline
            returnKeyType="default"
            maxLength={4000}
          />
          <Pressable
            style={[s.sendBtn, (!text.trim() || sending) && s.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color="#000" />
              : <Ionicons name="send" size={18} color="#000" />
            }
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  flex: { flex: 1 },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#111", alignItems: "center", justifyContent: "center",
  },
  headerCenter: { alignItems: "center" },
  headerTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  headerSub: { color: "#06b6d4", fontSize: 11, marginTop: 1 },

  messageList: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },

  welcomeBanner: {
    alignItems: "center", paddingVertical: 24, paddingHorizontal: 16,
    marginBottom: 8,
  },
  welcomeIcon: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: "rgba(6,182,212,0.1)", borderWidth: 1,
    borderColor: "rgba(6,182,212,0.2)",
    alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  welcomeTitle: { color: "#fff", fontSize: 18, fontWeight: "800", marginBottom: 8 },
  welcomeSub: { color: "#555", fontSize: 13, textAlign: "center", lineHeight: 20 },

  dateSep: { alignItems: "center", marginVertical: 12 },
  dateSepText: { color: "#333", fontSize: 11, fontWeight: "700" },

  msgRow: { flexDirection: "row", marginBottom: 8, maxWidth: "80%" },
  msgRowMe: { alignSelf: "flex-end" },
  msgRowThem: { alignSelf: "flex-start" },

  adminAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(6,182,212,0.1)", borderWidth: 1,
    borderColor: "rgba(6,182,212,0.2)",
    alignItems: "center", justifyContent: "center",
    marginRight: 8, marginTop: 4,
  },

  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, maxWidth: "100%" },
  bubbleMe: { backgroundColor: "#06b6d4", borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: "#1a1a1a", borderBottomLeftRadius: 4 },

  adminLabel: { color: "#06b6d4", fontSize: 10, fontWeight: "800", marginBottom: 3 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextMe: { color: "#000" },
  bubbleTextThem: { color: "#e0e0e0" },

  bubbleTime: { fontSize: 10, marginTop: 4 },
  bubbleTimeMe: { color: "rgba(0,0,0,0.5)", textAlign: "right" },
  bubbleTimeThem: { color: "#444" },

  emptyState: { alignItems: "center", paddingTop: 40, gap: 10 },
  emptyText: { color: "#333", fontSize: 14 },

  offlineBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(245,158,11,0.08)", borderTopWidth: 1,
    borderColor: "rgba(245,158,11,0.2)", paddingHorizontal: 16, paddingVertical: 10,
  },
  offlineBannerText: { color: "#f59e0b", fontSize: 12, flex: 1 },

  inputRow: {
    flexDirection: "row", alignItems: "flex-end", gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a",
    backgroundColor: "#000",
  },
  input: {
    flex: 1, backgroundColor: "#111", borderRadius: 20,
    borderWidth: 1, borderColor: "#1e1e1e",
    color: "#fff", fontSize: 15, paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: "#0a4a55", opacity: 0.5 },
});
