import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/avatar";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

const MOD_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
const POST_LIMIT = 280;

type ForumPost = {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  content: string;
  created_at: string;
};

export default function ForumDetailScreen() {
  const { forumId, title: forumTitle } = useLocalSearchParams<{ forumId: string; title: string }>();
  const { user, loading: authLoading } = useRequireAuth();
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newPost, setNewPost] = useState("");
  const [posting, setPosting] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  async function loadPosts() {
    if (!forumId) return;
    const { data } = await supabase
      .from("forum_posts")
      .select("id, user_id, content, created_at")
      .eq("forum_id", forumId)
      .order("created_at", { ascending: true });

    const userIds = [...new Set((data ?? []).map((p: any) => p.user_id as string))];
    let profileMap: Record<string, { username: string; avatar_url: string | null }> = {};
    if (userIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, username, avatar_url").in("id", userIds);
      for (const p of profiles ?? []) profileMap[(p as any).id] = { username: (p as any).username, avatar_url: (p as any).avatar_url };
    }

    setPosts((data ?? []).map((p: any) => ({
      id: p.id, user_id: p.user_id,
      username: profileMap[p.user_id]?.username ?? "Unknown",
      avatar_url: profileMap[p.user_id]?.avatar_url ?? null,
      content: p.content, created_at: p.created_at,
    })));
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { if (user && forumId) loadPosts(); }, [user, forumId]);

  async function handlePost() {
    if (!user || !newPost.trim() || !forumId) return;
    setPosting(true);

    try {
      const modRes = await fetch(`${MOD_BASE}/api/moderation/text`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newPost }),
      });
      if (modRes.ok) {
        const { flagged, reason } = await modRes.json();
        if (flagged) {
          Alert.alert("Post blocked", reason ?? "Your post was flagged by our content filter.");
          setPosting(false);
          return;
        }
      }
    } catch {}

    const { data, error } = await supabase
      .from("forum_posts")
      .insert({ forum_id: forumId, user_id: user.id, content: newPost.trim() })
      .select("id, created_at")
      .single();

    setPosting(false);
    if (error) { Alert.alert("Error", error.message); return; }

    const newEntry: ForumPost = {
      id: data.id, user_id: user.id,
      username: "You", avatar_url: null,
      content: newPost.trim(), created_at: data.created_at,
    };
    setPosts((prev) => [...prev, newEntry]);
    setNewPost("");
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/forums" as any)}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>{forumTitle ?? "Forum"}</Text>
            <Text style={styles.headerSub}>{posts.length} {posts.length === 1 ? "post" : "posts"}</Text>
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}>
          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={posts.length === 0 ? styles.emptyContainer : styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadPosts(); }} tintColor="#06b6d4" />}
          >
            {posts.length === 0 ? (
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="chatbubbles-outline" size={32} color="#333" />
                </View>
                <Text style={styles.emptyTitle}>No posts yet</Text>
                <Text style={styles.emptySub}>Be the first to start the discussion!</Text>
              </View>
            ) : (
              posts.map((post, i) => (
                <View key={post.id} style={[styles.postCard, i === posts.length - 1 && { marginBottom: 8 }]}>
                  <View style={styles.postHeader}>
                    <Avatar uri={post.avatar_url} name={post.username} size={36} />
                    <View style={styles.postMeta}>
                      <Text style={styles.postAuthor}>{post.username}</Text>
                      <Text style={styles.postTime}>{relTime(post.created_at)}</Text>
                    </View>
                  </View>
                  <Text style={styles.postContent}>{post.content}</Text>
                </View>
              ))
            )}
          </ScrollView>

          {/* Reply input */}
          <View style={styles.replyBar}>
            <TextInput
              style={styles.replyInput}
              placeholder="Write a post…"
              placeholderTextColor="#333"
              value={newPost}
              onChangeText={setNewPost}
              multiline
              maxLength={POST_LIMIT}
              editable={!posting}
            />
            <View style={styles.replyActions}>
              <Text style={styles.charCount}>{newPost.length}/{POST_LIMIT}</Text>
              <Pressable
                style={[styles.replyBtn, (!newPost.trim() || posting) && { opacity: 0.4 }]}
                onPress={handlePost}
                disabled={!newPost.trim() || posting}
              >
                {posting
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Ionicons name="send" size={16} color="#000" />}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  safe: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },
  headerSub: { color: "#444", fontSize: 12, marginTop: 1 },

  emptyContainer: { flex: 1 },
  list: { padding: 16, paddingBottom: 8 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyIcon: { width: 70, height: 70, borderRadius: 35, backgroundColor: "#141414", borderWidth: 1, borderColor: "#222", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  emptySub: { color: "#555", fontSize: 14 },

  postCard: {
    backgroundColor: "#111", borderRadius: 16,
    borderWidth: 1, borderColor: "#1e1e1e",
    padding: 14, marginBottom: 10,
  },
  postHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  postMeta: { flex: 1 },
  postAuthor: { color: "#fff", fontSize: 14, fontWeight: "800" },
  postTime: { color: "#444", fontSize: 11, marginTop: 2 },
  postContent: { color: "#ccc", fontSize: 15, lineHeight: 22 },

  replyBar: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a",
    backgroundColor: "#0d0d0d",
    padding: 12, paddingBottom: Platform.OS === "ios" ? 28 : 12,
  },
  replyInput: {
    color: "#fff", fontSize: 15, lineHeight: 22,
    maxHeight: 100, textAlignVertical: "top",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e1e1e",
    paddingBottom: 10, marginBottom: 8,
  },
  replyActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12 },
  charCount: { color: "#333", fontSize: 12 },
  replyBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
  },
});
