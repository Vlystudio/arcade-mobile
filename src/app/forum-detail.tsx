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
import { showToast } from "../components/toast";
import { ReportSheet, type ReportTarget } from "../components/report-sheet";
import { MentionText } from "../components/mention-text";
import { router as navRouter } from "expo-router";
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

type Poll = {
  id: string;
  post_id: string;
  options: string[];
  votes: number[];
  my_vote: number | null;
  total: number;
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
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  // Polls
  const [pollsByPost, setPollsByPost] = useState<Record<string, Poll>>({});
  const [pollOptions, setPollOptions] = useState<string[]>([]);
  const [voting, setVoting] = useState<string | null>(null);

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

    // Polls for these posts
    let pollRows: any[] = [];
    let voteRows: any[] = [];
    if (postIds.length) {
      const { data: pData } = await supabase
        .from("forum_polls").select("id, post_id, options").in("post_id", postIds);
      pollRows = pData ?? [];
      if (pollRows.length) {
        const { data: vData } = await supabase
          .from("forum_poll_votes").select("poll_id, user_id, option_idx")
          .in("poll_id", pollRows.map((x: any) => x.id));
        voteRows = vData ?? [];
      }
    }
    const polls: Record<string, Poll> = {};
    for (const pr of pollRows) {
      const opts: string[] = Array.isArray(pr.options) ? pr.options : [];
      const votes = opts.map((_, i) => voteRows.filter((v) => v.poll_id === pr.id && v.option_idx === i).length);
      const mine = voteRows.find((v) => v.poll_id === pr.id && v.user_id === user?.id);
      polls[pr.post_id] = {
        id: pr.id, post_id: pr.post_id, options: opts, votes,
        my_vote: mine ? mine.option_idx : null,
        total: votes.reduce((a, b) => a + b, 0),
      };
    }
    setPollsByPost(polls);

    // Blocked users are filtered out of the thread
    const { data: blocks } = await supabase
      .from("user_blocks").select("blocked_id").eq("blocker_id", user!.id);
    const blockedIds = new Set((blocks ?? []).map((b: any) => b.blocked_id));

    const userIds = [...new Set([
      ...(data ?? []).map((p: any) => p.user_id as string),
      ...commentsData.map((c: any) => c.user_id as string),
    ])];
    let profileMap: Record<string, { username: string; avatar_url: string | null }> = {};
    if (userIds.length) {
      const { data: profiles } = await supabase.from("public_profiles").select("id, username, avatar_url").in("id", userIds);
      for (const p of profiles ?? []) profileMap[(p as any).id] = { username: (p as any).username, avatar_url: (p as any).avatar_url };
    }

    setPosts((data ?? []).filter((p: any) => !blockedIds.has(p.user_id)).map((p: any) => ({
      id: p.id, user_id: p.user_id,
      username: profileMap[p.user_id]?.username ?? "Unknown",
      avatar_url: profileMap[p.user_id]?.avatar_url ?? null,
      content: p.content, created_at: p.created_at,
    })));

    const grouped: Record<string, PostComment[]> = {};
    for (const c of commentsData.filter((x: any) => !blockedIds.has(x.user_id))) {
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

    // Attach a poll when options were provided
    const validOpts = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (validOpts.length >= 2) {
      const { data: pollData } = await supabase
        .from("forum_polls")
        .insert({ post_id: data.id, options: validOpts })
        .select("id")
        .single();
      if (pollData) {
        setPollsByPost((prev) => ({
          ...prev,
          [data.id]: { id: pollData.id, post_id: data.id, options: validOpts, votes: validOpts.map(() => 0), my_vote: null, total: 0 },
        }));
      }
      setPollOptions([]);
    }

    const newEntry: ForumPost = {
      id: data.id, user_id: user.id,
      username: "You", avatar_url: null,
      content: forumPost.value, created_at: data.created_at,
    };
    setPosts((prev) => [...prev, newEntry]);
    setNewPost("");
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  async function votePoll(poll: Poll, idx: number) {
    if (!user || voting) return;
    setVoting(poll.id);
    await supabase.from("forum_poll_votes").upsert(
      { poll_id: poll.id, user_id: user.id, option_idx: idx },
      { onConflict: "poll_id,user_id" },
    );
    setPollsByPost((prev) => {
      const cur = prev[poll.post_id];
      if (!cur) return prev;
      const votes = [...cur.votes];
      if (cur.my_vote != null) votes[cur.my_vote] = Math.max(votes[cur.my_vote] - 1, 0);
      votes[idx] += 1;
      return { ...prev, [poll.post_id]: { ...cur, votes, my_vote: idx, total: votes.reduce((a, b) => a + b, 0) } };
    });
    setVoting(null);
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
          showToast("Comment deleted", "info");
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
                        <Pressable onPress={() => navRouter.push({ pathname: "/user-profile" as any, params: { userId: post.user_id } })}>
                          <Avatar uri={post.avatar_url} name={post.username} size={36} />
                        </Pressable>
                        <Pressable style={styles.postMeta} onPress={() => navRouter.push({ pathname: "/user-profile" as any, params: { userId: post.user_id } })}>
                          <Text style={styles.postAuthor}>{post.username}</Text>
                          <Text style={styles.postTime}>{relTime(post.created_at)}</Text>
                        </Pressable>
                        {post.user_id !== user?.id && (
                          <Pressable
                            onPress={() => setReportTarget({ type: "forum_post", id: post.id, label: `Post by ${post.username}` })}
                            hitSlop={8}
                          >
                            <Ionicons name="flag-outline" size={14} color="#444" />
                          </Pressable>
                        )}
                      </View>
                      <MentionText style={styles.postContent}>{post.content}</MentionText>

                      {/* Poll */}
                      {pollsByPost[post.id] && (
                        <View style={styles.pollWrap}>
                          {pollsByPost[post.id].options.map((opt, idx) => {
                            const poll = pollsByPost[post.id];
                            const count = poll.votes[idx] ?? 0;
                            const pct = poll.total > 0 ? Math.round((count / poll.total) * 100) : 0;
                            const mine = poll.my_vote === idx;
                            return (
                              <Pressable key={idx} style={styles.pollOption} onPress={() => votePoll(poll, idx)} disabled={voting === poll.id}>
                                <View style={[styles.pollFill, { width: `${Math.max(pct, poll.my_vote != null ? 2 : 0)}%` as any }, mine && styles.pollFillMine]} />
                                <View style={styles.pollOptionRow}>
                                  <Text style={[styles.pollOptionText, mine && { color: "#06b6d4", fontWeight: "800" }]} numberOfLines={1}>
                                    {mine ? "✓ " : ""}{opt}
                                  </Text>
                                  {poll.my_vote != null && <Text style={styles.pollPct}>{pct}%</Text>}
                                </View>
                              </Pressable>
                            );
                          })}
                          <Text style={styles.pollTotal}>
                            {pollsByPost[post.id].total} {pollsByPost[post.id].total === 1 ? "vote" : "votes"}
                          </Text>
                        </View>
                      )}

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
                                  <Pressable onPress={() => navRouter.push({ pathname: "/user-profile" as any, params: { userId: c.user_id } })}>
                                    <Text style={styles.commentAuthor}>{c.username}</Text>
                                  </Pressable>
                                  <Text style={styles.commentTime}>{relTime(c.created_at)}</Text>
                                  {c.user_id !== user?.id && (
                                    <Pressable
                                      onPress={() => setReportTarget({ type: "forum_comment", id: c.id, label: `Comment by ${c.username}` })}
                                      hitSlop={8}
                                    >
                                      <Ionicons name="flag-outline" size={12} color="#444" />
                                    </Pressable>
                                  )}
                                  {c.user_id === user?.id && (
                                    <Pressable onPress={() => handleDeleteComment(c)} hitSlop={8} disabled={deletingComment === c.id}>
                                      {deletingComment === c.id
                                        ? <ActivityIndicator size="small" color="#555" />
                                        : <Ionicons name="trash-outline" size={13} color="#553333" />}
                                    </Pressable>
                                  )}
                                </View>
                                <MentionText style={styles.commentContent}>{c.content}</MentionText>
                              </View>
                            </View>
                          ))}

                          {/* Comment composer */}
                          <View style={styles.commentComposer}>
                            <TextInput
                              style={styles.commentInput}
                              placeholder="Write a comment…"
                              placeholderTextColor="#555"
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
            {pollOptions.length > 0 && (
              <View style={{ gap: 6, marginBottom: 8 }}>
                {pollOptions.map((opt, i) => (
                  <View key={i} style={styles.pollInputRow}>
                    <TextInput
                      style={styles.pollInput}
                      placeholder={`Poll option ${i + 1}`}
                      placeholderTextColor="#555"
                      value={opt}
                      onChangeText={(t) => setPollOptions((prev) => prev.map((x, j) => (j === i ? t : x)))}
                      maxLength={60}
                    />
                    <Pressable onPress={() => setPollOptions((prev) => prev.filter((_, j) => j !== i))} hitSlop={6}>
                      <Ionicons name="close-circle" size={18} color="#555" />
                    </Pressable>
                  </View>
                ))}
                {pollOptions.length < 4 && (
                  <Pressable style={styles.pollAddBtn} onPress={() => setPollOptions((prev) => [...prev, ""])}>
                    <Ionicons name="add" size={14} color="#06b6d4" />
                    <Text style={styles.pollAddText}>Add option</Text>
                  </Pressable>
                )}
              </View>
            )}
              <TextInput
                style={styles.replyInput}
                placeholder="Start a new post…"
                placeholderTextColor="#555"
                value={newPost}
                onChangeText={setNewPost}
                multiline
                maxLength={POST_LIMIT}
                editable={!posting}
              />
              <View style={styles.replyActions}>
                <Pressable
                  style={styles.pollToggleBtn}
                onPress={() => setPollOptions((prev) => (prev.length ? [] : ["", ""]))}
                hitSlop={6}
              >
                <Ionicons name="stats-chart-outline" size={15} color={pollOptions.length ? "#06b6d4" : "#555"} />
                <Text style={[styles.pollAddText, !pollOptions.length && { color: "#6e6e6e" }]}>Poll</Text>
                </Pressable>
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
      <ReportSheet target={reportTarget} onClose={() => setReportTarget(null)} />
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
  headerSub: { color: "#777", fontSize: 12, marginTop: 1 },

  emptyContainer: { flexGrow: 1 },
  list: { padding: 16, paddingBottom: 8 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyIcon: { width: 70, height: 70, borderRadius: 35, backgroundColor: "#141414", borderWidth: 1, borderColor: "#222", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  emptySub: { color: "#8a8a8a", fontSize: 14 },

  postCard: {
    backgroundColor: "#111", borderRadius: 16,
    borderWidth: 1, borderColor: "#1a1a1a",
    padding: 14, marginBottom: 10,
  },
  postHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  postMeta: { flex: 1 },
  postAuthor: { color: "#fff", fontSize: 14, fontWeight: "800" },
  postTime: { color: "#777", fontSize: 11, marginTop: 2 },
  postContent: { color: "#ccc", fontSize: 15, lineHeight: 22 },

  postFooter: {
    flexDirection: "row", alignItems: "center",
    marginTop: 12, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1c1c1c",
  },
  commentToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  commentToggleText: { color: "#777", fontSize: 12.5, fontWeight: "700" },

  // ── Comment thread ──
  thread: { marginTop: 10, gap: 10 },
  commentRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, paddingLeft: 8 },
  threadLine: { width: 2, alignSelf: "stretch", backgroundColor: "#1c1c1c", borderRadius: 1, marginRight: 1 },
  commentBody: { flex: 1, backgroundColor: "#0c0c0c", borderRadius: 12, padding: 10, borderWidth: 1, borderColor: "#191919" },
  commentTopRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 },
  commentAuthor: { color: "#ddd", fontSize: 12.5, fontWeight: "800", flexShrink: 1 },
  commentTime: { color: "#6b6b6b", fontSize: 10.5, flex: 1 },
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

  pollWrap: { marginTop: 10, gap: 6 },
  pollOption: {
    borderRadius: 10, borderWidth: 1, borderColor: "#242424",
    backgroundColor: "#0c0c0c", overflow: "hidden",
  },
  pollFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "rgba(100,116,139,0.18)" },
  pollFillMine: { backgroundColor: "rgba(6,182,212,0.16)" },
  pollOptionRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 9, gap: 8 },
  pollOptionText: { flex: 1, color: "#ccc", fontSize: 13.5, fontWeight: "600" },
  pollPct: { color: "#8a8a8a", fontSize: 12.5, fontWeight: "800" },
  pollTotal: { color: "#6e6e6e", fontSize: 11, marginTop: 2 },
  pollInputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pollInput: {
    flex: 1, backgroundColor: "#0c0c0c", borderRadius: 10,
    borderWidth: 1, borderColor: "#222",
    color: "#fff", fontSize: 13.5, paddingHorizontal: 11, paddingVertical: 8,
  },
  pollAddBtn: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingVertical: 3 },
  pollAddText: { color: "#06b6d4", fontSize: 12.5, fontWeight: "700" },
  pollToggleBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginRight: "auto" },

  replyBar: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a",
    backgroundColor: "#0d0d0d",
    padding: 12, paddingBottom: Platform.OS === "ios" ? 28 : 12,
  },
  replyInput: {
    color: "#fff", fontSize: 15, lineHeight: 22,
    maxHeight: 100, textAlignVertical: "top",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
    paddingBottom: 10, marginBottom: 8,
  },
  replyActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12 },
  charCount: { color: "#333", fontSize: 12 },
  replyBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
  },
});
