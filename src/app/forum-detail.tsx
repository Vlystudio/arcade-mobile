import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { Alert } from "../../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/avatar";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

import { API_BASE as MOD_BASE } from "../../lib/api-base";
import { validateChatMessage, VALIDATION_LIMITS } from "../../lib/validation";
const POST_LIMIT = VALIDATION_LIMITS.chatMessage;
const COMMENT_LIMIT = 1000;

type ForumPost = {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  content: string;
  created_at: string;
};

type PostComment = {
  id: string;
  post_id: string;
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
  const [commentsByPost, setCommentsByPost] = useState<Record<string, PostComment[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newPost, setNewPost] = useState("");
  const [posting, setPosting] = useState(false);

  // Comment composer state (one open thread at a time)
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [deletingComment, setDeletingComment] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  async function loadPosts() {
    if (!forumId) return;
    const { data } = await supabase
      .from("forum_posts")
      .select("id, user_id, content, created_at")
      .eq("forum_id", forumId)
      .order("created_at", { ascending: true });

    const postIds = (data ?? []).map((p: any) => p.id as string);

    // Load all comments for these posts in one query
    let commentsData: any[] = [];
    if (postIds.length) {
      const { data: cData } = await supabase
        .from("forum_post_comments")
        .select("id, post_id, user_id, content, created_at")
        .in("post_id", postIds)
        .order("created_at", { ascending: true });
      commentsData = cData ?? [];
    }

    const userIds = [...new Set([
      ...(data ?? []).map((p: any) => p.user_id as string),
      ...commentsData.map((c: any) => c.user_id as string),
    ])];
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

    const grouped: Record<string, PostComment[]> = {};
    for (const c of commentsData) {
      (grouped[c.post_id] ??= []).push({
        id: c.id, post_id: c.post_id, user_id: c.user_id,
        username: profileMap[c.user_id]?.username ?? "Unknown",
        avatar_url: profileMap[c.user_id]?.avatar_url ?? null,
        content: c.content, created_at: c.created_at,
      });
    }
    setCommentsByPost(grouped);

    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { if (user && forumId) loadPosts(); }, [user, forumId]);

  async function moderate(text: string): Promise<boolean> {
    try {
      const modRes = await fetch(`${MOD_BASE}/api/moderation/text`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (modRes.ok) {
        const { flagged, reason } = await modRes.json();
        if (flagged) {
          Alert.alert("Blocked", reason ?? "Your message was flagged by our content filter.");
          return false;
        }
      }
    } catch {}
    return true;
  }

  async function handlePost() {
    const forumPost = validateChatMessage(newPost);
    if (!user || !forumPost.ok || !forumId) return;
    setPosting(true);

    if (!(await moderate(forumPost.value))) { setPosting(false); return; }

    const { data, error } = await supabase
      .from("forum_posts")
      .insert({ forum_id: forumId, user_id: user.id, content: forumPost.value })
      .select("id, created_at")
      .single();

    setPosting(false);
    if (error) { Alert.alert("Error", error.message); return; }

    const newEntry: ForumPost = {
      id: data.id, user_id: user.id,
      username: "You", avatar_url: null,
      content: forumPost.value, created_at: data.created_at,
    };
    setPosts((prev) => [...prev, newEntry]);
    setNewPost("");
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  function toggleComments(postId: string) {
    setCommentDraft("");
    setExpandedPost((prev) => (prev === postId ? null : postId));
  }

  async function handleComment(postId: string) {
    const trimmed = commentDraft.trim();
    if (!user || !trimmed || trimmed.length > COMMENT_LIMIT) return;
    setCommenting(true);

    if (!(await moderate(trimmed))) { setCommenting(false); return; }

    const { data, error } = await supabase
      .from("forum_post_comments")
      .insert({ post_id: postId, user_id: user.id, content: trimmed })
      .select("id, created_at")
      .single();

    setCommenting(false);
    if (error) { Alert.alert("Error", error.message); return; }

    const newComment: PostComment = {
      id: data.id, post_id: postId, user_id: user.id,
      username: "You", avatar_url: null,
      content: trimmed, created_at: data.created_at,
    };
    setCommentsByPost((prev) => ({ ...prev, [postId]: [...(prev[postId] ?? []), newComment] }));
    setCommentDraft("");
  }

  async function handleDeleteComment(comment: PostComment) {
    Alert.alert("Delete comment?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          setDeletingComment(comment.id);
          const { error } = await supabase.from("forum_post_comments").delete().eq("id", comment.id);
          setDeletingComment(null);
          if (error) { Alert.alert("Error", error.message); return; }
          setCommentsByPost((prev) => ({
            ...prev,
            [comment.post_id]: (prev[comment.post_id] ?? []).filter((c) => c.id !== comment.id),
          }));
        },
      },
    ]);
  }

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  const totalComments = Object.values(commentsByPost).reduce((a, c) => a + c.length, 0);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.pageWrap}>
          <View style={styles.header}>
            <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/forums" as any)}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle} numberOfLines={1}>{forumTitle ?? "Forum"}</Text>
              <Text style={styles.headerSub}>
                {posts.length} {posts.length === 1 ? "post" : "posts"}
                {totalComments > 0 ? ` · ${totalComments} ${totalComments === 1 ? "comment" : "comments"}` : ""}
              </Text>
            </View>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
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
                posts.map((post, i) => {
                  const comments = commentsByPost[post.id] ?? [];
                  const isExpanded = expandedPost === post.id;
                  return (
                    <View key={post.id} style={[styles.postCard, i === posts.length - 1 && { marginBottom: 8 }]}>
                      <View style={styles.postHeader}>
                        <Avatar uri={post.avatar_url} name={post.username} size={36} />
                        <View style={styles.postMeta}>
                          <Text style={styles.postAuthor}>{post.username}</Text>
                          <Text style={styles.postTime}>{relTime(post.created_at)}</Text>
                        </View>
                      </View>
                      <Text style={styles.postContent}>{post.content}</Text>

                      {/* Comment toggle bar */}
                      <View style={styles.postFooter}>
                        <Pressable style={styles.commentToggle} onPress={() => toggleComments(post.id)} hitSlop={6}>
                          <Ionicons
                            name={isExpanded ? "chatbubble" : "chatbubble-outline"}
                            size={15}
                            color={comments.length > 0 || isExpanded ? "#06b6d4" : "#444"}
                          />
                          <Text style={[styles.commentToggleText, (comments.length > 0 || isExpanded) && { color: "#06b6d4" }]}>
                            {comments.length > 0
                              ? `${comments.length} ${comments.length === 1 ? "comment" : "comments"}`
                              : "Comment"}
                          </Text>
                          {comments.length > 0 && (
                            <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={13} color="#444" />
                          )}
                        </Pressable>
                      </View>

                      {/* Comment thread */}
                      {isExpanded && (
                        <View style={styles.thread}>
                          {comments.map((c) => (
                            <View key={c.id} style={styles.commentRow}>
                              <View style={styles.threadLine} />
                              <Avatar uri={c.avatar_url} name={c.username} size={26} />
                              <View style={styles.commentBody}>
                                <View style={styles.commentTopRow}>
                                  <Text style={styles.commentAuthor}>{c.username}</Text>
                                  <Text style={styles.commentTime}>{relTime(c.created_at)}</Text>
                                  {c.user_id === user?.id && (
                                    <Pressable onPress={() => handleDeleteComment(c)} hitSlop={8} disabled={deletingComment === c.id}>
                                      {deletingComment === c.id
                                        ? <ActivityIndicator size="small" color="#555" />
                                        : <Ionicons name="trash-outline" size={13} color="#553333" />}
                                    </Pressable>
                                  )}
                                </View>
                                <Text style={styles.commentContent}>{c.content}</Text>
                              </View>
                            </View>
                          ))}

                          {/* Comment composer */}
                          <View style={styles.commentComposer}>
                            <TextInput
                              style={styles.commentInput}
                              placeholder="Write a comment…"
                              placeholderTextColor="#333"
                              value={commentDraft}
                              onChangeText={setCommentDraft}
                              multiline
                              maxLength={COMMENT_LIMIT}
                              editable={!commenting}
                            />
                            <Pressable
                              style={[styles.commentSendBtn, (!commentDraft.trim() || commenting) && { opacity: 0.4 }]}
                              onPress={() => handleComment(post.id)}
                              disabled={!commentDraft.trim() || commenting}
                            >
                              {commenting
                                ? <ActivityIndicator size="small" color="#000" />
                                : <Ionicons name="arrow-up" size={15} color="#000" />}
                            </Pressable>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </ScrollView>

            {/* New post input */}
            <View style={styles.replyBar}>
              <TextInput
                style={styles.replyInput}
                placeholder="Start a new post…"
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
        </View>
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

  // Constrain width on desktop web; full width on mobile
  pageWrap: { flex: 1, width: "100%", maxWidth: 820, alignSelf: "center" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },
  headerSub: { color: "#444", fontSize: 12, marginTop: 1 },

  emptyContainer: { flexGrow: 1 },
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

  postFooter: {
    flexDirection: "row", alignItems: "center",
    marginTop: 12, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1c1c1c",
  },
  commentToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  commentToggleText: { color: "#444", fontSize: 12.5, fontWeight: "700" },

  // ── Comment thread ──
  thread: { marginTop: 10, gap: 10 },
  commentRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, paddingLeft: 8 },
  threadLine: { width: 2, alignSelf: "stretch", backgroundColor: "#1c1c1c", borderRadius: 1, marginRight: 1 },
  commentBody: { flex: 1, backgroundColor: "#0c0c0c", borderRadius: 12, padding: 10, borderWidth: 1, borderColor: "#191919" },
  commentTopRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 },
  commentAuthor: { color: "#ddd", fontSize: 12.5, fontWeight: "800", flexShrink: 1 },
  commentTime: { color: "#3a3a3a", fontSize: 10.5, flex: 1 },
  commentContent: { color: "#aaa", fontSize: 13.5, lineHeight: 19 },

  commentComposer: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingLeft: 8, marginTop: 2,
  },
  commentInput: {
    flex: 1, color: "#fff", fontSize: 13.5, lineHeight: 19,
    backgroundColor: "#0c0c0c", borderRadius: 12,
    borderWidth: 1, borderColor: "#222",
    paddingHorizontal: 12, paddingVertical: 9,
    maxHeight: 90,
  },
  commentSendBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
  },

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
