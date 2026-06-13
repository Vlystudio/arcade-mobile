import AsyncStorage from "@react-native-async-storage/async-storage";
import { FlashList } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
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
import { Alert } from "../../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomTabBar from "../components/bottom-tab-bar";
import { Avatar } from "../components/avatar";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";
import { openUserProfile } from "../lib/open-profile";

type Conversation = {
  id: string;
  other_user_id: string;
  other_username: string;
  other_avatar_url: string | null;
  last_message: string | null;
  last_message_at: string | null;
};

type FriendResult = {
  id: string;
  username: string;
  avatar_url: string | null;
  online_status: string;
};

const SWIPE_SPRING = { damping: 22, stiffness: 220, mass: 0.7 };

export default function ChatScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [unreadMap, setUnreadMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [newChatVisible, setNewChatVisible] = useState(false);
  const [friends, setFriends] = useState<FriendResult[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [creating, setCreating] = useState(false);

  async function loadConversations() {
    if (!user) return;

    const { data: convData } = await supabase
      .from("conversations")
      .select("id, participant_1, participant_2, last_message, last_message_at")
      .or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`)
      .order("last_message_at", { ascending: false, nullsFirst: false });

    if (!convData?.length) {
      setConversations([]);
      setLoading(false);
      return;
    }

    // Hide conversations with users you've blocked
    const { data: blocks } = await supabase
      .from("user_blocks").select("blocked_id").eq("blocker_id", user.id);
    const blockedIds = new Set((blocks ?? []).map((b: any) => b.blocked_id));
    const visibleConvs = convData.filter((c: any) =>
      !blockedIds.has(c.participant_1 === user.id ? c.participant_2 : c.participant_1)
    );

    const otherIds = visibleConvs.map((c: any) =>
      c.participant_1 === user.id ? c.participant_2 : c.participant_1
    );

    const { data: profileData } = await supabase
      .from("public_profiles")
      .select("id, username, avatar_url")
      .in("id", otherIds);

    const profileMap: Record<string, { username: string; avatar_url: string | null }> = {};
    for (const p of profileData ?? []) {
      profileMap[(p as any).id] = {
        username: (p as any).username ?? "Unknown",
        avatar_url: (p as any).avatar_url ?? null,
      };
    }

    const mapped: Conversation[] = visibleConvs.map((c: any) => {
      const otherId = c.participant_1 === user.id ? c.participant_2 : c.participant_1;
      const profile = profileMap[otherId];
      return {
        id: c.id,
        other_user_id: otherId,
        other_username: profile?.username ?? "Unknown",
        other_avatar_url: profile?.avatar_url ?? null,
        last_message: c.last_message,
        last_message_at: c.last_message_at,
      };
    });

    setConversations(mapped);
    setLoading(false);

    const entries = await Promise.all(
      mapped.map(async (c) => {
        const lastRead = await AsyncStorage.getItem(`read_${c.id}`);
        const isUnread =
          !!c.last_message_at &&
          (!lastRead || new Date(c.last_message_at) > new Date(lastRead));
        return [c.id, isUnread] as [string, boolean];
      })
    );
    setUnreadMap(Object.fromEntries(entries));
  }

  async function markRead(convId: string) {
    await AsyncStorage.setItem(`read_${convId}`, new Date().toISOString());
    setUnreadMap((prev) => ({ ...prev, [convId]: false }));
  }

  async function openConversation(conv: Conversation) {
    await markRead(conv.id);
    router.push({
      pathname: "/chat-conversation" as any,
      params: {
        conversationId: conv.id,
        otherUserId: conv.other_user_id,
        otherUsername: conv.other_username,
        otherAvatarUrl: conv.other_avatar_url ?? "",
      },
    });
  }

  async function deleteConversation(convId: string) {
    setConversations((prev) => prev.filter((c) => c.id !== convId));
    await AsyncStorage.removeItem(`read_${convId}`);
    await supabase.from("messages").delete().eq("conversation_id", convId);
    await supabase.from("conversations").delete().eq("id", convId);
  }

  async function loadFriends() {
    if (!user) return;
    setFriendsLoading(true);

    const { data: fs } = await supabase
      .from("friendships")
      .select("requester_id, addressee_id")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .eq("status", "accepted");

    if (!fs || fs.length === 0) {
      setFriends([]);
      setFriendsLoading(false);
      return;
    }

    const ids = fs.map((f: any) =>
      f.requester_id === user.id ? f.addressee_id : f.requester_id
    );

    const { data: profiles } = await supabase
      .from("public_profiles")
      .select("id, username, avatar_url, online_status")
      .in("id", ids);

    setFriends((profiles ?? []).map((p: any) => ({
      id: p.id,
      username: p.username ?? "Unknown",
      avatar_url: p.avatar_url ?? null,
      online_status: p.online_status ?? "offline",
    })));
    setFriendsLoading(false);
  }

  async function openOrCreateConversation(friend: FriendResult) {
    if (!user || creating) return;
    setCreating(true);

    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .or(`and(participant_1.eq.${user.id},participant_2.eq.${friend.id}),and(participant_1.eq.${friend.id},participant_2.eq.${user.id})`)
      .maybeSingle();

    let convId: string;
    if (existing) {
      convId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from("conversations")
        .insert({ participant_1: user.id, participant_2: friend.id })
        .select("id")
        .single();
      if (error || !created) { setCreating(false); return; }
      convId = created.id;
    }

    setCreating(false);
    setNewChatVisible(false);
    setFilterText("");

    await markRead(convId);
    router.push({
      pathname: "/chat-conversation" as any,
      params: {
        conversationId: convId,
        otherUserId: friend.id,
        otherUsername: friend.username,
        otherAvatarUrl: friend.avatar_url ?? "",
      },
    });
  }

  function openModal() {
    setNewChatVisible(true);
    loadFriends();
  }

  useEffect(() => {
    if (!user) return;
    loadConversations();

    const channel = supabase
      .channel(`chats:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `participant_1=eq.${user.id}` }, () => loadConversations())
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `participant_2=eq.${user.id}` }, () => loadConversations())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  const filteredFriends = filterText.trim()
    ? friends.filter((f) => f.username.toLowerCase().includes(filterText.toLowerCase()))
    : friends;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/")}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Messages</Text>
          <Pressable style={styles.newBtn} onPress={openModal}>
            <Ionicons name="create-outline" size={22} color="#06b6d4" />
          </Pressable>
        </View>

        {conversations.length === 0 ? (
          <ScrollView contentContainerStyle={styles.emptyWrap}>
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={52} color="#222" />
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptySub}>Send a message to someone on your friends list.</Text>
              <Pressable style={styles.emptyBtn} onPress={openModal}>
                <Text style={styles.emptyBtnText}>New Message</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <FlashList
            data={conversations}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <SwipeableConvRow
                conv={item}
                isUnread={!!unreadMap[item.id]}
                onOpen={() => openConversation(item)}
                onDelete={() =>
                  Alert.alert(
                    "Delete conversation",
                    "This will remove the chat for both you and the other person.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Delete", style: "destructive", onPress: () => deleteConversation(item.id) },
                    ]
                  )
                }
              />
            )}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
      <BottomTabBar />

      {/* New chat modal */}
      <Modal visible={newChatVisible} transparent animationType="slide" onRequestClose={() => setNewChatVisible(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalTop}>
              <Text style={styles.modalTitle}>New Message</Text>
              <Pressable onPress={() => { setNewChatVisible(false); setFilterText(""); }}>
                <Ionicons name="close" size={22} color="#555" />
              </Pressable>
            </View>

            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={16} color="#444" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search friends…"
                placeholderTextColor="#555"
                autoFocus
                autoCapitalize="none"
                value={filterText}
                onChangeText={setFilterText}
              />
            </View>

            <ScrollView style={styles.resultsList} keyboardShouldPersistTaps="handled">
              {friendsLoading ? (
                <ActivityIndicator color="#06b6d4" style={{ paddingVertical: 24 }} />
              ) : filteredFriends.length === 0 ? (
                <View style={styles.noFriendsWrap}>
                  <Ionicons name="people-outline" size={32} color="#222" />
                  <Text style={styles.noResults}>
                    {friends.length === 0 ? "No friends yet" : "No matches"}
                  </Text>
                  {friends.length === 0 && (
                    <Pressable onPress={() => { setNewChatVisible(false); router.push("/friends" as any); }}>
                      <Text style={styles.addFriendsLink}>Add friends →</Text>
                    </Pressable>
                  )}
                </View>
              ) : (
                filteredFriends.map((f) => (
                  <Pressable
                    key={f.id}
                    style={({ pressed }) => [styles.resultRow, pressed && { opacity: 0.7 }]}
                    onPress={() => openOrCreateConversation(f)}
                    disabled={creating}
                  >
                    <View style={styles.avatarWrap}>
                      <Avatar uri={f.avatar_url} name={f.username} size={40} />
                      <View style={[styles.statusDot, f.online_status === "online" && styles.statusDotOnline]} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultUsername}>{f.username}</Text>
                      <Text style={styles.resultStatus}>{f.online_status === "online" ? "Online" : "Offline"}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#333" />
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Swipeable conversation row ───────────────────────────────────────────────

function SwipeableConvRow({
  conv,
  isUnread,
  onOpen,
  onDelete,
}: {
  conv: Conversation;
  isUnread: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const translateX = useSharedValue(0);
  const isOpen = useSharedValue(false);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-15, 15])
    .onUpdate((e) => {
      if (e.translationX < 0 && !isOpen.value) {
        translateX.value = Math.max(e.translationX, -80);
      } else if (isOpen.value) {
        translateX.value = Math.min(-80 + e.translationX, 0);
      }
    })
    .onEnd((e) => {
      const shouldOpen = e.translationX < -40 && !isOpen.value;
      const shouldClose = e.translationX > 30 && isOpen.value;
      if (shouldOpen) {
        translateX.value = withSpring(-80, SWIPE_SPRING);
        isOpen.value = true;
      } else if (shouldClose) {
        translateX.value = withSpring(0, SWIPE_SPRING);
        isOpen.value = false;
      } else {
        translateX.value = withSpring(isOpen.value ? -80 : 0, SWIPE_SPRING);
      }
    });

  function close() {
    translateX.value = withSpring(0, SWIPE_SPRING);
    isOpen.value = false;
  }

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View style={styles.swipeContainer}>
      <View style={styles.deleteAction}>
        <Pressable style={styles.deleteBtn} onPress={() => { close(); onDelete(); }}>
          <Ionicons name="trash-outline" size={20} color="#fff" />
          <Text style={styles.deleteBtnText}>Delete</Text>
        </Pressable>
      </View>

      <GestureDetector gesture={panGesture}>
        <Animated.View style={animStyle}>
          <Pressable
            style={({ pressed }) => [
              styles.convRow,
              pressed && !isOpen.value && { backgroundColor: "#0d0d0d" },
            ]}
            onPress={() => {
              if (isOpen.value) { close(); } else { onOpen(); }
            }}
          >
            <Pressable onPress={() => openUserProfile(conv.other_user_id)}>
              <Avatar uri={conv.other_avatar_url} name={conv.other_username} size={46} />
            </Pressable>
            <View style={styles.convBody}>
              <Text style={[styles.convName, isUnread && styles.convNameUnread]}>
                {conv.other_username}
              </Text>
              <Text style={[styles.convLast, isUnread && styles.convLastUnread]} numberOfLines={1}>
                {conv.last_message ?? "No messages yet"}
              </Text>
            </View>
            <View style={styles.convMeta}>
              {conv.last_message_at && (
                <Text style={styles.convTime}>{relTime(conv.last_message_at)}</Text>
              )}
              {isUnread && <View style={styles.unreadDot} />}
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  newBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },

  emptyWrap: { flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, paddingTop: 80, gap: 10 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  emptySub: { color: "#8a8a8a", fontSize: 14, textAlign: "center" },
  emptyBtn: { marginTop: 8, backgroundColor: "#06b6d4", borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },

  swipeContainer: { overflow: "hidden" },
  deleteAction: {
    position: "absolute", right: 0, top: 0, bottom: 0, width: 80,
    backgroundColor: "#ef4444",
    alignItems: "center", justifyContent: "center",
  },
  deleteBtn: { alignItems: "center", gap: 4 },
  deleteBtnText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  convRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#111",
    backgroundColor: "#000",
  },
  convBody: { flex: 1 },
  convName: { color: "#ccc", fontSize: 15, fontWeight: "700", marginBottom: 2 },
  convNameUnread: { color: "#fff", fontWeight: "900" },
  convLast: { color: "#777", fontSize: 13 },
  convLastUnread: { color: "#888", fontWeight: "600" },
  convMeta: { alignItems: "flex-end", gap: 5 },
  convTime: { color: "#777", fontSize: 12 },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#06b6d4" },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: Platform.OS === "ios" ? 36 : 24,
    maxHeight: "80%",
    borderTopWidth: 1, borderColor: "#1a1a1a",
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 18 },
  modalTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  modalTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#0a0a0a", borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: "#1a1a1a", marginBottom: 12,
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 15 },
  resultsList: { maxHeight: 300 },
  resultRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  avatarWrap: { position: "relative" },
  statusDot: {
    position: "absolute", bottom: 0, right: 0,
    width: 11, height: 11, borderRadius: 6,
    backgroundColor: "#444", borderWidth: 2, borderColor: "#111",
  },
  statusDotOnline: { backgroundColor: "#22c55e" },
  resultUsername: { color: "#fff", fontSize: 15, fontWeight: "700" },
  resultStatus: { color: "#8a8a8a", fontSize: 12, marginTop: 1 },
  noFriendsWrap: { alignItems: "center", gap: 8, paddingVertical: 28 },
  noResults: { color: "#777", textAlign: "center", fontSize: 14 },
  addFriendsLink: { color: "#06b6d4", fontSize: 14, fontWeight: "700" },
});
