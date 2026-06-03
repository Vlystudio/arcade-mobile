import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomTabBar from "../components/bottom-tab-bar";
import { Avatar } from "../components/avatar";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

type Conversation = {
  id: string;
  other_user_id: string;
  other_username: string;
  other_avatar_url: string | null;
  last_message: string | null;
  last_message_at: string | null;
};

type UserResult = { id: string; username: string };

export default function ChatScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [newChatVisible, setNewChatVisible] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);

  async function loadConversations() {
    if (!user) return;

    const { data } = await supabase
      .from("conversations")
      .select("id, participant_1, participant_2, last_message, last_message_at, p1:profiles!participant_1(username, avatar_url), p2:profiles!participant_2(username, avatar_url)")
      .or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`)
      .order("last_message_at", { ascending: false });

    const mapped: Conversation[] = (data ?? []).map((c: any) => {
      const isP1 = c.participant_1 === user.id;
      const otherProfile = isP1
        ? (Array.isArray(c.p2) ? c.p2[0] : c.p2)
        : (Array.isArray(c.p1) ? c.p1[0] : c.p1);
      return {
        id: c.id,
        other_user_id: isP1 ? c.participant_2 : c.participant_1,
        other_username: otherProfile?.username ?? "Unknown",
        other_avatar_url: otherProfile?.avatar_url ?? null,
        last_message: c.last_message,
        last_message_at: c.last_message_at,
      };
    });

    setConversations(mapped);
    setLoading(false);
  }

  async function searchUsers(text: string) {
    if (!text.trim() || !user) { setSearchResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, username")
      .ilike("username", `%${text.trim()}%`)
      .neq("id", user.id)
      .limit(8);
    setSearchResults(data ?? []);
    setSearching(false);
  }

  async function openOrCreateConversation(otherUserId: string) {
    if (!user || creating) return;
    setCreating(true);

    // Look for existing conversation (either direction)
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .or(`and(participant_1.eq.${user.id},participant_2.eq.${otherUserId}),and(participant_1.eq.${otherUserId},participant_2.eq.${user.id})`)
      .maybeSingle();

    let convId: string;

    if (existing) {
      convId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from("conversations")
        .insert({ participant_1: user.id, participant_2: otherUserId })
        .select("id")
        .single();
      if (error || !created) { setCreating(false); return; }
      convId = created.id;
    }

    setCreating(false);
    setNewChatVisible(false);
    setSearchText("");
    setSearchResults([]);

    const other = searchResults.find((r) => r.id === otherUserId);
    router.push({ pathname: "/chat-conversation" as any, params: { conversationId: convId, otherUsername: other?.username ?? "Chat" } });
  }

  useEffect(() => { if (user) loadConversations(); }, [user]);

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Messages</Text>
          <Pressable style={styles.newBtn} onPress={() => setNewChatVisible(true)}>
            <Ionicons name="create-outline" size={22} color="#06b6d4" />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={conversations.length === 0 ? styles.emptyWrap : undefined}>
          {conversations.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={52} color="#222" />
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptySub}>Start a conversation with another player.</Text>
              <Pressable style={styles.emptyBtn} onPress={() => setNewChatVisible(true)}>
                <Text style={styles.emptyBtnText}>New Message</Text>
              </Pressable>
            </View>
          ) : (
            conversations.map((c) => (
              <Pressable
                key={c.id}
                style={({ pressed }) => [styles.convRow, pressed && { backgroundColor: "#0d0d0d" }]}
                onPress={() => router.push({ pathname: "/chat-conversation" as any, params: { conversationId: c.id, otherUsername: c.other_username, otherAvatarUrl: c.other_avatar_url ?? "" } })}
              >
                <Avatar uri={c.other_avatar_url} name={c.other_username} size={46} />
                <View style={styles.convBody}>
                  <Text style={styles.convName}>{c.other_username}</Text>
                  <Text style={styles.convLast} numberOfLines={1}>{c.last_message ?? "No messages yet"}</Text>
                </View>
                {c.last_message_at && (
                  <Text style={styles.convTime}>{relTime(c.last_message_at)}</Text>
                )}
              </Pressable>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
      <BottomTabBar />

      {/* New chat modal */}
      <Modal visible={newChatVisible} transparent animationType="slide" onRequestClose={() => setNewChatVisible(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalTop}>
              <Text style={styles.modalTitle}>New Message</Text>
              <Pressable onPress={() => { setNewChatVisible(false); setSearchText(""); setSearchResults([]); }}>
                <Ionicons name="close" size={22} color="#555" />
              </Pressable>
            </View>

            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={16} color="#444" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by username…"
                placeholderTextColor="#333"
                autoFocus
                autoCapitalize="none"
                value={searchText}
                onChangeText={(t) => { setSearchText(t); searchUsers(t); }}
              />
              {searching && <ActivityIndicator size="small" color="#06b6d4" />}
            </View>

            <ScrollView style={styles.resultsList} keyboardShouldPersistTaps="handled">
              {searchResults.map((u) => (
                <Pressable
                  key={u.id}
                  style={({ pressed }) => [styles.resultRow, pressed && { opacity: 0.7 }]}
                  onPress={() => openOrCreateConversation(u.id)}
                  disabled={creating}
                >
                  <Avatar uri={null} name={u.username} size={40} />
                  <Text style={styles.resultUsername}>{u.username}</Text>
                  <Ionicons name="chevron-forward" size={16} color="#333" />
                </Pressable>
              ))}
              {searchText.trim().length > 0 && searchResults.length === 0 && !searching && (
                <Text style={styles.noResults}>No users found</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  safe: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  headerTitle: { color: "#fff", fontSize: 22, fontWeight: "900" },
  newBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },

  emptyWrap: { flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, paddingTop: 80, gap: 10 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  emptySub: { color: "#555", fontSize: 14, textAlign: "center" },
  emptyBtn: { marginTop: 8, backgroundColor: "#06b6d4", borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },

  convRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#111",
  },
  convAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#1c1c1c", alignItems: "center", justifyContent: "center" },
  convAvatarText: { color: "#fff", fontWeight: "800", fontSize: 18 },
  convBody: { flex: 1 },
  convName: { color: "#fff", fontSize: 15, fontWeight: "800", marginBottom: 2 },
  convLast: { color: "#555", fontSize: 13 },
  convTime: { color: "#444", fontSize: 12 },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: Platform.OS === "ios" ? 36 : 24,
    maxHeight: "80%",
    borderTopWidth: 1, borderColor: "#1e1e1e",
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 18 },
  modalTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  modalTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#0a0a0a", borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 12,
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 15 },
  resultsList: { maxHeight: 300 },
  resultRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  resultAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#1c1c1c", alignItems: "center", justifyContent: "center" },
  resultAvatarText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  resultUsername: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700" },
  noResults: { color: "#444", textAlign: "center", paddingVertical: 20, fontSize: 14 },
});
