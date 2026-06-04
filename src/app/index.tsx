import { pickFromCamera, pickFromLibrary } from "../../lib/pick-image";
import { compressImage, MAX_UPLOAD_BYTES } from "../../lib/compress-image";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { useAdmin } from "../context/admin-context";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
import BottomTabBar from "../components/bottom-tab-bar";
import { Avatar } from "../components/avatar";
import { ImageLightbox } from "../components/image-lightbox";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";
import { moderateImage } from "../../lib/moderate-image";
import { moderateText } from "../../lib/moderate-text";

type Post = {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  content: string | null;
  photo_url: string | null;
  score_value: number | null;
  game_name: string | null;
  post_type: string;
  like_count: number;
  liked_by_me: boolean;
  comment_count: number;
  created_at: string;
};

type Comment = {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  content: string;
  created_at: string;
};

type ConvPreview = {
  id: string;
  other_user_id: string;
  other_username: string;
  other_avatar: string | null;
};

type FeedTab = "following" | "arcade";

export default function FeedScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const { isArcadeOfficial, isAdmin } = useAdmin();
  const [tab, setTab] = useState<FeedTab>("following");
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [postContent, setPostContent] = useState("");
  const [postAsAnnouncement, setPostAsAnnouncement] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postPhotoUri, setPostPhotoUri] = useState<string | null>(null);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);

  // Comments
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [commentPosting, setCommentPosting] = useState(false);

  // Share score as DM
  const [sharePost, setSharePost] = useState<Post | null>(null);
  const [shareConvs, setShareConvs] = useState<ConvPreview[]>([]);
  const [shareConvsLoading, setShareConvsLoading] = useState(false);
  const [sendingShareId, setSendingShareId] = useState<string | null>(null);


  // Edit state
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editPhotoUri, setEditPhotoUri] = useState<string | null>(null);
  const [editPhotoRemoved, setEditPhotoRemoved] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function loadFeed(feedTab: FeedTab) {
    if (!user) return;

    // Step 1: get posts (no embedded joins — avoids FK relationship errors)
    let baseQuery = supabase
      .from("posts")
      .select("id, user_id, content, post_type, created_at, score_id, photo_url")
      .order("created_at", { ascending: false })
      .limit(50);

    if (feedTab === "arcade") {
      baseQuery = baseQuery.eq("post_type", "announcement");
    } else {
      const [followingRes, followersRes] = await Promise.all([
        supabase.from("follows").select("following_id").eq("follower_id", user.id),
        supabase.from("follows").select("follower_id").eq("following_id", user.id),
      ]);
      const ids = [
        ...new Set([
          user.id,
          ...(followingRes.data?.map((f) => f.following_id) ?? []),
          ...(followersRes.data?.map((f) => f.follower_id) ?? []),
        ]),
      ];
      baseQuery = baseQuery.in("user_id", ids);
    }

    const { data: postsData, error: postsError } = await baseQuery;
    if (postsError) { console.error("[loadFeed] posts:", postsError.message); setLoading(false); setRefreshing(false); return; }
    if (!postsData?.length) { setPosts([]); setLoading(false); setRefreshing(false); return; }

    const postIds = postsData.map((p: any) => p.id);
    const userIds = [...new Set(postsData.map((p: any) => p.user_id as string))];
    const scoreIds = postsData.map((p: any) => p.score_id).filter(Boolean);

    // Step 2: parallel fetch of profiles, likes, scores, and comment counts
    const [profilesRes, likesRes, scoresRes, commentsRes] = await Promise.all([
      supabase.from("profiles").select("id, username, avatar_url").in("id", userIds),
      supabase.from("post_likes").select("post_id, user_id").in("post_id", postIds),
      scoreIds.length
        ? supabase.from("scores").select("id, score, game_id, games(name)").in("id", scoreIds)
        : Promise.resolve({ data: [] }),
      supabase.from("post_comments").select("post_id").in("post_id", postIds),
    ]);

    const profileMap = Object.fromEntries((profilesRes.data ?? []).map((p: any) => [p.id, p]));
    const likesMap: Record<string, string[]> = {};
    for (const l of likesRes.data ?? []) {
      if (!likesMap[l.post_id]) likesMap[l.post_id] = [];
      likesMap[l.post_id].push(l.user_id);
    }
    const scoreMap = Object.fromEntries((scoresRes.data ?? []).map((s: any) => [s.id, s]));
    const commentCountMap: Record<string, number> = {};
    for (const c of commentsRes.data ?? []) {
      commentCountMap[(c as any).post_id] = (commentCountMap[(c as any).post_id] ?? 0) + 1;
    }

    const mapped: Post[] = postsData.map((p: any) => {
      const profile = profileMap[p.user_id];
      const score = p.score_id ? scoreMap[p.score_id] : null;
      const game = score ? (Array.isArray(score.games) ? score.games[0] : score.games) : null;
      const postLikes = likesMap[p.id] ?? [];
      return {
        id: p.id,
        user_id: p.user_id,
        username: profile?.username ?? "Unknown",
        avatar_url: profile?.avatar_url ?? null,
        content: p.content,
        photo_url: p.photo_url ?? null,
        score_value: score?.score ?? null,
        game_name: game?.name ?? null,
        post_type: p.post_type,
        like_count: postLikes.length,
        liked_by_me: postLikes.includes(user.id),
        comment_count: commentCountMap[p.id] ?? 0,
        created_at: p.created_at,
      };
    });

    setPosts(mapped);
    setLoading(false);
    setRefreshing(false);
  }

  async function loadProfile() {
    if (!user) return;
    const { data } = await supabase.from("profiles").select("username, avatar_url").eq("id", user.id).single();
    if (data) { setUsername(data.username); setMyAvatarUrl(data.avatar_url ?? null); }
  }

  useEffect(() => {
    if (user) { loadProfile(); loadFeed(tab); }
  }, [user]);


  async function switchTab(t: FeedTab) {
    setTab(t);
    setLoading(true);
    await loadFeed(t);
  }

  async function handleLike(postId: string, liked: boolean) {
    if (!user) return;
    if (liked) {
      await supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", user.id);
    } else {
      await supabase.from("post_likes").insert({ post_id: postId, user_id: user.id });
    }
    setPosts((prev) => prev.map((p) => p.id !== postId ? p : {
      ...p, liked_by_me: !liked, like_count: liked ? p.like_count - 1 : p.like_count + 1,
    }));
  }

  async function handleDelete(postId: string) {
    const { error } = await supabase.from("posts").delete().eq("id", postId);
    if (error) {
      Alert.alert("Error", "Could not delete post: " + error.message);
      return;
    }
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }

  function openEdit(post: Post) {
    setEditingPost(post);
    setEditContent(post.content ?? "");
    setEditPhotoUri(null);
    setEditPhotoRemoved(false);
    setEditError(null);
  }

  async function pickEditPhoto(source: "camera" | "library") {
    const asset = source === "camera"
      ? await pickFromCamera({ allowsEditing: false, quality: 0.85 })
      : await pickFromLibrary({ allowsEditing: false, quality: 0.85 });
    if (asset) { setEditPhotoUri(asset.uri); setEditPhotoRemoved(false); }
  }

  async function handleSaveEdit() {
    if (!editingPost || !user) return;
    if (!editContent.trim() && !editPhotoUri && editPhotoRemoved && !editingPost.photo_url) {
      setEditError("Post must have text or a photo.");
      return;
    }
    setEditSaving(true);
    setEditError(null);

    // Determine new photo_url: undefined = unchanged, null = removed, string = new URL
    let nextPhotoUrl: string | null | undefined = undefined;

    if (editPhotoUri) {
      try {
        const compressed = await compressImage(editPhotoUri);
        const response = await fetch(compressed);
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_UPLOAD_BYTES) {
          setEditError("Photo is too large (max 5 MB). Please choose a smaller image.");
          setEditSaving(false);
          return;
        }
        const path = `${user.id}/${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("post-photos")
          .upload(path, arrayBuffer, { upsert: false, contentType: "image/jpeg" });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from("post-photos").getPublicUrl(path);
        const candidateUrl = urlData.publicUrl;

        // Moderate before saving to DB — delete orphaned file if flagged
        const modResult = await moderateImage({
          imageUrl:   candidateUrl,
          bucket:     "post-photos",
          path,
          recordType: "post",
          recordId:   editingPost.id,
        });
        if (!modResult.ok) {
          await supabase.storage.from("post-photos").remove([path]);
          setEditError(modResult.message ?? "Photo was flagged by content moderation.");
          setEditSaving(false);
          return;
        }

        nextPhotoUrl = candidateUrl;
      } catch (err: any) {
        setEditError("Photo upload failed: " + (err.message ?? "unknown error"));
        setEditSaving(false);
        return;
      }
    } else if (editPhotoRemoved) {
      nextPhotoUrl = null;
    }

    const updates: Record<string, any> = { content: editContent.trim() || null };
    if (nextPhotoUrl !== undefined) updates.photo_url = nextPhotoUrl;

    const { error } = await supabase.from("posts").update(updates).eq("id", editingPost.id);
    setEditSaving(false);
    if (error) { setEditError(error.message); return; }

    setPosts((prev) => prev.map((p) => p.id !== editingPost.id ? p : {
      ...p,
      content: editContent.trim() || null,
      photo_url: nextPhotoUrl !== undefined ? nextPhotoUrl : p.photo_url,
    }));
    setEditingPost(null);
  }

  async function pickPostPhoto(source: "camera" | "library") {
    const asset = source === "camera"
      ? await pickFromCamera({ allowsEditing: false, quality: 0.85 })
      : await pickFromLibrary({ allowsEditing: false, quality: 0.85 });
    if (asset) setPostPhotoUri(asset.uri);
  }

  async function handlePost() {
    if (!user || (!postContent.trim() && !postPhotoUri)) return;
    setPostError(null);
    setPosting(true);

    if (postContent.trim()) {
      const textMod = await moderateText(postContent.trim());
      if (!textMod.ok) {
        setPostError(textMod.message);
        setPosting(false);
        return;
      }
    }

    let photoUrl: string | null = null;
    if (postPhotoUri) {
      try {
        const compressed = await compressImage(postPhotoUri);
        const response = await fetch(compressed);
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_UPLOAD_BYTES) {
          setPostError("Photo is too large (max 5 MB). Please choose a smaller image.");
          setPosting(false);
          return;
        }
        const path = `${user.id}/${Date.now()}.jpg`;
        const { error: uploadErr } = await supabase.storage
          .from("post-photos")
          .upload(path, arrayBuffer, { upsert: false, contentType: "image/jpeg" });
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from("post-photos").getPublicUrl(path);
        photoUrl = urlData.publicUrl;

        const mod = await moderateImage({ imageUrl: photoUrl, bucket: "post-photos", path, recordType: "post", recordId: "" });
        if (!mod.ok) {
          await supabase.storage.from("post-photos").remove([path]);
          setPostError(mod.message);
          setPosting(false);
          return;
        }
      } catch (err: any) {
        setPostError("Photo upload failed: " + (err.message ?? "unknown error"));
        setPosting(false);
        return;
      }
    }

    const { error } = await supabase.from("posts").insert({
      user_id: user.id,
      content: postContent.trim() || null,
      post_type: isArcadeOfficial && postAsAnnouncement ? "announcement" : "post",
      photo_url: photoUrl,
    });
    setPosting(false);
    if (error) {
      console.error("[handlePost]", error.message);
      setPostError(error.message);
      return;
    }
    setPostContent("");
    setPostPhotoUri(null);
    setPostError(null);
    setPostAsAnnouncement(false);
    setCreateVisible(false);
    loadFeed(tab);
  }

  async function loadComments(postId: string) {
    setCommentsLoading(true);
    const { data } = await supabase
      .from("post_comments")
      .select("id, user_id, content, created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });

    const userIds = [...new Set((data ?? []).map((c: any) => c.user_id as string))];
    let profileMap: Record<string, { username: string; avatar_url: string | null }> = {};
    if (userIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, username, avatar_url").in("id", userIds);
      for (const p of profiles ?? []) profileMap[(p as any).id] = { username: (p as any).username, avatar_url: (p as any).avatar_url };
    }

    setComments((data ?? []).map((c: any) => ({
      id: c.id, user_id: c.user_id,
      username: profileMap[c.user_id]?.username ?? "Unknown",
      avatar_url: profileMap[c.user_id]?.avatar_url ?? null,
      content: c.content, created_at: c.created_at,
    })));
    setCommentsLoading(false);
  }

  async function submitComment() {
    if (!user || !commentPostId || !newComment.trim()) return;
    setCommentPosting(true);

    const mod = await moderateText(newComment.trim());
    if (!mod.ok) {
      Alert.alert("Comment blocked", mod.message);
      setCommentPosting(false);
      return;
    }

    const { error } = await supabase.from("post_comments").insert({
      post_id: commentPostId, user_id: user.id, content: newComment.trim(),
    });
    setCommentPosting(false);
    if (error) { Alert.alert("Error", error.message); return; }

    setComments((prev) => [...prev, {
      id: Date.now().toString(), user_id: user.id,
      username: username ?? "You", avatar_url: myAvatarUrl,
      content: newComment.trim(), created_at: new Date().toISOString(),
    }]);
    setNewComment("");
    setPosts((prev) => prev.map((p) => p.id === commentPostId ? { ...p, comment_count: p.comment_count + 1 } : p));
  }

  async function openShare(post: Post) {
    setSharePost(post);
    setShareConvsLoading(true);
    const { data: convData } = await supabase
      .from("conversations")
      .select("id, participant_1, participant_2")
      .or(`participant_1.eq.${user!.id},participant_2.eq.${user!.id}`)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(30);

    const otherIds = (convData ?? []).map((c: any) =>
      c.participant_1 === user!.id ? c.participant_2 : c.participant_1
    );
    let profileMap: Record<string, { username: string; avatar_url: string | null }> = {};
    if (otherIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, username, avatar_url").in("id", otherIds);
      for (const p of profiles ?? []) profileMap[(p as any).id] = { username: (p as any).username, avatar_url: (p as any).avatar_url };
    }

    setShareConvs((convData ?? []).map((c: any) => {
      const otherId = c.participant_1 === user!.id ? c.participant_2 : c.participant_1;
      return { id: c.id, other_user_id: otherId, other_username: profileMap[otherId]?.username ?? "Unknown", other_avatar: profileMap[otherId]?.avatar_url ?? null };
    }));
    setShareConvsLoading(false);
  }

  async function sendShare(convId: string) {
    if (!sharePost || !user) return;
    setSendingShareId(convId);
    const scoreText = sharePost.score_value != null
      ? `Score: ${sharePost.score_value.toLocaleString()}${sharePost.game_name ? ` on ${sharePost.game_name}` : ""} 🏆`
      : sharePost.content ?? "";
    const msgContent = `Check out @${sharePost.username}'s post:\n${scoreText}`;

    await supabase.from("messages").insert({ conversation_id: convId, sender_id: user.id, content: msgContent });
    await supabase.from("conversations").update({ last_message: msgContent, last_message_at: new Date().toISOString() }).eq("id", convId);

    setSendingShareId(null);
    setSharePost(null);
    Alert.alert("Sent!", "Post shared via message.");
  }

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerBrand}>
            <View style={styles.brandRow}>
              <View style={styles.headerDot} />
              <Text style={styles.headerTitle}>Arcade</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable style={styles.iconBtn} onPress={() => router.push("/forums" as any)}>
              <Ionicons name="chatbubbles-outline" size={21} color="#888" />
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => router.push("/chat" as any)}>
              <Ionicons name="chatbubble-outline" size={21} color="#888" />
            </Pressable>
            <Pressable style={styles.iconBtnCyan} onPress={() => setCreateVisible(true)}>
              <Ionicons name="add" size={20} color="#000" />
            </Pressable>
          </View>
        </View>

        {/* Tab switcher */}
        <View style={styles.tabRow}>
          <View style={styles.tabPill}>
            {(["following", "arcade"] as FeedTab[]).map((t) => (
              <Pressable
                key={t}
                style={[styles.feedTab, tab === t && styles.feedTabActive]}
                onPress={() => switchTab(t)}
              >
                <Text style={[styles.feedTabText, tab === t && styles.feedTabTextActive]}>
                  {t === "following" ? "Following" : "Arcade"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={posts.length === 0 ? styles.emptyContainer : undefined}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadFeed(tab); }} tintColor="#06b6d4" />
          }
        >
          {posts.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name={tab === "following" ? "people-outline" : "megaphone-outline"} size={34} color="#333" />
              </View>
              <Text style={styles.emptyTitle}>
                {tab === "following" ? "Nothing here yet" : "No announcements"}
              </Text>
              <Text style={styles.emptySub}>
                {tab === "following"
                  ? "Follow people or post something to get started."
                  : "Official arcade announcements will appear here."}
              </Text>
              {tab === "following" && (
                <Pressable style={styles.emptyBtn} onPress={() => setCreateVisible(true)}>
                  <Ionicons name="pencil" size={14} color="#000" />
                  <Text style={styles.emptyBtnText}>Create a Post</Text>
                </Pressable>
              )}
            </View>
          ) : (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                isMe={post.user_id === user?.id}
                canDelete={post.user_id === user?.id || isAdmin || isArcadeOfficial}
                canEdit={post.user_id === user?.id}
                onLike={() => handleLike(post.id, post.liked_by_me)}
                onDelete={() => handleDelete(post.id)}
                onEdit={() => openEdit(post)}
                onImagePress={(uri) => setLightboxUri(uri)}
                onComment={() => { setCommentPostId(post.id); setComments([]); setNewComment(""); loadComments(post.id); }}
                onShare={() => openShare(post)}
              />
            ))
          )}
        </ScrollView>
      </SafeAreaView>

      <BottomTabBar />

      <ImageLightbox uri={lightboxUri} onClose={() => setLightboxUri(null)} />


      {/* Comments modal */}
      <Modal
        visible={commentPostId !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setCommentPostId(null)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalBg}>
            <Pressable style={styles.modalDismiss} onPress={() => setCommentPostId(null)} />
            <View style={[styles.modalSheet, { maxHeight: "80%" }]}>
              <View style={styles.modalHandle} />
              <View style={styles.modalTop}>
                <Text style={styles.editModalTitle}>Comments</Text>
                <Pressable style={styles.modalCloseBtn} onPress={() => setCommentPostId(null)}>
                  <Ionicons name="close" size={18} color="#555" />
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
                {commentsLoading ? (
                  <ActivityIndicator color="#06b6d4" style={{ marginVertical: 30 }} />
                ) : comments.length === 0 ? (
                  <View style={styles.cmtEmpty}>
                    <Ionicons name="chatbubble-outline" size={28} color="#333" />
                    <Text style={styles.cmtEmptyText}>No comments yet. Be first!</Text>
                  </View>
                ) : (
                  comments.map((c) => (
                    <View key={c.id} style={styles.cmtRow}>
                      <Avatar uri={c.avatar_url} name={c.username} size={32} />
                      <View style={styles.cmtBubble}>
                        <Text style={styles.cmtAuthor}>{c.username}</Text>
                        <Text style={styles.cmtContent}>{c.content}</Text>
                      </View>
                    </View>
                  ))
                )}
                <View style={{ height: 8 }} />
              </ScrollView>
              <View style={styles.cmtInputRow}>
                <Avatar uri={myAvatarUrl} name={username ?? "Y"} size={30} />
                <TextInput
                  style={styles.cmtInput}
                  placeholder="Add a comment…"
                  placeholderTextColor="#333"
                  value={newComment}
                  onChangeText={setNewComment}
                  maxLength={280}
                  returnKeyType="send"
                  onSubmitEditing={submitComment}
                  editable={!commentPosting}
                />
                <Pressable
                  style={[styles.cmtSendBtn, (!newComment.trim() || commentPosting) && { opacity: 0.4 }]}
                  onPress={submitComment}
                  disabled={!newComment.trim() || commentPosting}
                >
                  {commentPosting
                    ? <ActivityIndicator size="small" color="#000" />
                    : <Ionicons name="send" size={16} color="#000" />}
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Share score modal */}
      <Modal
        visible={sharePost !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSharePost(null)}
      >
        <View style={styles.modalBg}>
          <Pressable style={styles.modalDismiss} onPress={() => setSharePost(null)} />
          <View style={[styles.modalSheet, { maxHeight: "70%" }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalTop}>
              <View>
                <Text style={styles.editModalTitle}>Share to Messages</Text>
                <Text style={styles.shareSubtitle}>
                  {sharePost?.score_value != null
                    ? `${sharePost.score_value.toLocaleString()} pts${sharePost.game_name ? ` · ${sharePost.game_name}` : ""}`
                    : sharePost?.username ?? ""}
                </Text>
              </View>
              <Pressable style={styles.modalCloseBtn} onPress={() => setSharePost(null)}>
                <Ionicons name="close" size={18} color="#555" />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {shareConvsLoading ? (
                <ActivityIndicator color="#06b6d4" style={{ marginVertical: 30 }} />
              ) : shareConvs.length === 0 ? (
                <View style={styles.cmtEmpty}>
                  <Ionicons name="chatbubble-outline" size={28} color="#333" />
                  <Text style={styles.cmtEmptyText}>No conversations yet. Start a chat first!</Text>
                </View>
              ) : (
                shareConvs.map((conv) => (
                  <Pressable
                    key={conv.id}
                    style={styles.shareConvRow}
                    onPress={() => sendShare(conv.id)}
                    disabled={sendingShareId === conv.id}
                  >
                    <Avatar uri={conv.other_avatar} name={conv.other_username} size={40} />
                    <Text style={styles.shareConvName}>{conv.other_username}</Text>
                    {sendingShareId === conv.id
                      ? <ActivityIndicator size="small" color="#06b6d4" />
                      : <Ionicons name="paper-plane-outline" size={18} color="#06b6d4" />}
                  </Pressable>
                ))
              )}
              <View style={{ height: 16 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit post modal */}
      <Modal visible={editingPost !== null} transparent animationType="slide" onRequestClose={() => setEditingPost(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalBg}>
            <Pressable style={styles.modalDismiss} onPress={() => setEditingPost(null)} />
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <View style={styles.modalTop}>
                <Text style={styles.editModalTitle}>Edit Post</Text>
                <Pressable style={styles.modalCloseBtn} onPress={() => setEditingPost(null)}>
                  <Ionicons name="close" size={18} color="#555" />
                </Pressable>
              </View>

              <TextInput
                style={styles.postInput}
                placeholder="What's on your mind?"
                placeholderTextColor="#333"
                multiline
                value={editContent}
                onChangeText={(t) => { setEditContent(t); setEditError(null); }}
                maxLength={280}
              />

              {(editPhotoUri || (editingPost?.photo_url && !editPhotoRemoved)) && (
                <View style={styles.photoPreviewWrap}>
                  <Image
                    source={{ uri: editPhotoUri ?? editingPost!.photo_url! }}
                    style={styles.photoPreview}
                    contentFit="cover"
                  />
                  <Pressable
                    style={styles.photoRemoveBtn}
                    onPress={() => { if (editPhotoUri) setEditPhotoUri(null); else setEditPhotoRemoved(true); }}
                  >
                    <Ionicons name="close-circle" size={22} color="#fff" />
                  </Pressable>
                </View>
              )}

              {editError && (
                <View style={styles.postErrorBox}>
                  <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
                  <Text style={styles.postErrorText}>{editError}</Text>
                </View>
              )}

              <View style={styles.modalFooter}>
                <Pressable style={styles.photoPickBtn} onPress={() => pickEditPhoto("camera")}>
                  <Ionicons name="camera-outline" size={20} color={editPhotoUri ? "#06b6d4" : "#555"} />
                </Pressable>
                <Pressable style={styles.photoPickBtn} onPress={() => pickEditPhoto("library")}>
                  <Ionicons name="image-outline" size={20} color={editPhotoUri ? "#06b6d4" : "#555"} />
                </Pressable>
                <Text style={styles.charCount}>{editContent.length} / 280</Text>
                <Pressable
                  style={[styles.postBtn, editSaving && styles.postBtnOff]}
                  onPress={handleSaveEdit}
                  disabled={editSaving}
                >
                  <Text style={styles.postBtnText}>{editSaving ? "Saving…" : "Save"}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Create post modal */}
      <Modal visible={createVisible} transparent animationType="slide" onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalBg}>
            {/* Tap outside to close */}
            <Pressable style={styles.modalDismiss} onPress={() => { setCreateVisible(false); setPostAsAnnouncement(false); }} />
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <View style={styles.modalTop}>
                <View style={styles.postAuthorRow}>
                  <Avatar uri={myAvatarUrl} name={username ?? "P"} size={38} />
                  <View>
                    <Text style={styles.postAuthorName}>{username ?? "You"}</Text>
                    <Text style={styles.postAudienceLabel}>
                      {isArcadeOfficial && postAsAnnouncement ? "Arcade Tab · Announcement" : "Public · Everyone can see"}
                    </Text>
                  </View>
                </View>
                <Pressable style={styles.modalCloseBtn} onPress={() => { setCreateVisible(false); setPostAsAnnouncement(false); }}>
                  <Ionicons name="close" size={18} color="#555" />
                </Pressable>
              </View>

              {/* Arcade official post-destination toggle */}
              {isArcadeOfficial && (
                <View style={styles.postDestRow}>
                  <Pressable
                    style={[styles.postDestBtn, !postAsAnnouncement && styles.postDestBtnActive]}
                    onPress={() => setPostAsAnnouncement(false)}
                  >
                    <Ionicons name="people-outline" size={14} color={!postAsAnnouncement ? "#fff" : "#444"} />
                    <Text style={[styles.postDestText, !postAsAnnouncement && styles.postDestTextActive]}>Following Feed</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.postDestBtn, postAsAnnouncement && styles.postDestBtnArcade]}
                    onPress={() => setPostAsAnnouncement(true)}
                  >
                    <Ionicons name="megaphone-outline" size={14} color={postAsAnnouncement ? "#06b6d4" : "#444"} />
                    <Text style={[styles.postDestText, postAsAnnouncement && styles.postDestTextArcade]}>Arcade Tab</Text>
                  </Pressable>
                </View>
              )}
              <TextInput
                style={styles.postInput}
                placeholder="What's on your mind?"
                placeholderTextColor="#333"
                multiline
                value={postContent}
                onChangeText={(t) => { setPostContent(t); setPostError(null); }}
                autoFocus
                maxLength={280}
              />

              {/* Attached photo preview */}
              {postPhotoUri && (
                <View style={styles.photoPreviewWrap}>
                  <Image source={{ uri: postPhotoUri }} style={styles.photoPreview} contentFit="cover" />
                  <Pressable style={styles.photoRemoveBtn} onPress={() => setPostPhotoUri(null)}>
                    <Ionicons name="close-circle" size={22} color="#fff" />
                  </Pressable>
                </View>
              )}

              {postError && (
                <View style={styles.postErrorBox}>
                  <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
                  <Text style={styles.postErrorText}>{postError}</Text>
                </View>
              )}

              <View style={styles.modalFooter}>
                <Pressable style={styles.photoPickBtn} onPress={() => pickPostPhoto("camera")}>
                  <Ionicons name="camera-outline" size={20} color={postPhotoUri ? "#06b6d4" : "#555"} />
                </Pressable>
                <Pressable style={styles.photoPickBtn} onPress={() => pickPostPhoto("library")}>
                  <Ionicons name="image-outline" size={20} color={postPhotoUri ? "#06b6d4" : "#555"} />
                </Pressable>
                <Text style={styles.charCount}>{postContent.length} / 280</Text>
                <Pressable
                  style={[styles.postBtn, (!postContent.trim() && !postPhotoUri || posting) && styles.postBtnOff]}
                  onPress={handlePost}
                  disabled={(!postContent.trim() && !postPhotoUri) || posting}
                >
                  <Text style={styles.postBtnText}>{posting ? "Posting…" : "Post"}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function PostCard({ post, canDelete, canEdit, onLike, onDelete, onEdit, onImagePress, onComment, onShare }: {
  post: Post;
  isMe: boolean;
  canDelete: boolean;
  canEdit: boolean;
  onLike: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onImagePress: (uri: string) => void;
  onComment: () => void;
  onShare: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isAnnouncement = post.post_type === "announcement";
  const hasScore = post.score_value != null;

  return (
    <>
    <View style={[styles.postCard, isAnnouncement && styles.postCardOfficial]}>
      {/* Author row */}
      <View style={styles.postHeader}>
        <Avatar uri={post.avatar_url} name={post.username} size={44} />
        <View style={styles.postMeta}>
          <View style={styles.postAuthorRow2}>
            <Text style={styles.postAuthor}>{post.username}</Text>
            {isAnnouncement && (
              <View style={styles.officialTag}>
                <Ionicons name="shield-checkmark" size={9} color="#06b6d4" />
                <Text style={styles.officialTagText}>Official</Text>
              </View>
            )}
          </View>
          <Text style={styles.postTime}>{relTime(post.created_at)}</Text>
        </View>
        {(canEdit || canDelete) && (
          <Pressable style={styles.postMenuBtn} onPress={() => setMenuOpen(true)} hitSlop={8}>
            <Ionicons name="ellipsis-horizontal" size={18} color="#444" />
          </Pressable>
        )}
      </View>

      {/* Score block */}
      {hasScore && (
        <View style={styles.scoreBlock}>
          <View>
            <Text style={styles.scoreBlockLabel}>NEW SCORE</Text>
            <Text style={styles.scoreBlockValue}>{post.score_value!.toLocaleString()}</Text>
          </View>
          <View style={styles.scoreBlockRight}>
            <View style={styles.trophyCircle}>
              <Ionicons name="trophy" size={20} color="#f59e0b" />
            </View>
            {post.game_name && <Text style={styles.scoreBlockGame}>{post.game_name}</Text>}
          </View>
        </View>
      )}

      {/* Text content */}
      {post.content ? <Text style={styles.postContent}>{post.content}</Text> : null}

      {/* Attached photo */}
      {post.photo_url && (
        <Pressable onPress={() => onImagePress(post.photo_url!)}>
          <Image
            source={{ uri: post.photo_url }}
            style={styles.postPhoto}
            contentFit="cover"
            cachePolicy="none"
          />
        </Pressable>
      )}

      {/* Footer */}
      <View style={styles.postFooter}>
        <Pressable style={styles.likeBtn} onPress={onLike}>
          <View style={[styles.likeIconWrap, post.liked_by_me && styles.likeIconWrapActive]}>
            <Ionicons
              name={post.liked_by_me ? "heart" : "heart-outline"}
              size={16}
              color={post.liked_by_me ? "#ef4444" : "#555"}
            />
          </View>
          {post.like_count > 0 && (
            <Text style={[styles.likeCount, post.liked_by_me && styles.likeCountActive]}>
              {post.like_count}
            </Text>
          )}
        </Pressable>
        <Pressable style={styles.likeBtn} onPress={onComment}>
          <View style={styles.likeIconWrap}>
            <Ionicons name="chatbubble-outline" size={15} color="#555" />
          </View>
          {post.comment_count > 0 && (
            <Text style={styles.likeCount}>{post.comment_count}</Text>
          )}
        </Pressable>
        {hasScore && (
          <Pressable style={styles.likeBtn} onPress={onShare}>
            <View style={styles.likeIconWrap}>
              <Ionicons name="paper-plane-outline" size={15} color="#555" />
            </View>
          </Pressable>
        )}
      </View>
    </View>

    {/* Post action sheet */}
    <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
      <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
        <View style={styles.menuSheet}>
          {canEdit && (
            <Pressable style={styles.menuItem} onPress={() => { setMenuOpen(false); onEdit(); }}>
              <Ionicons name="pencil-outline" size={16} color="#fff" />
              <Text style={styles.menuItemText}>Edit Post</Text>
            </Pressable>
          )}
          {canDelete && (
            <Pressable style={styles.menuItem} onPress={() => { setMenuOpen(false); onDelete(); }}>
              <Ionicons name="trash-outline" size={16} color="#ef4444" />
              <Text style={[styles.menuItemText, styles.menuItemDestructive]}>Delete Post</Text>
            </Pressable>
          )}
          <View style={styles.menuDivider} />
          <Pressable style={styles.menuItem} onPress={() => setMenuOpen(false)}>
            <Text style={styles.menuCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
    </>
  );
}

function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  safe: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center" },

  // Header
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 18, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  headerBrand: { flexDirection: "column", alignItems: "flex-start", gap: 6 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#06b6d4" },
  headerTitle: { color: "#fff", fontSize: 19, fontWeight: "900", letterSpacing: -0.4 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  locationPrompt: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 12, borderWidth: 1, borderColor: "#222",
    backgroundColor: "#111",
  },
  locationPromptText: { color: "#444", fontSize: 11, fontWeight: "600" },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  iconBtnCyan: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
  },

  // Tab switcher
  tabRow: { paddingHorizontal: 18, paddingVertical: 12 },
  tabPill: {
    flexDirection: "row", backgroundColor: "#141414",
    borderRadius: 12, padding: 3, borderWidth: 1, borderColor: "#222",
  },
  feedTab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  feedTabActive: { backgroundColor: "#1e1e1e" },
  feedTabText: { color: "#505050", fontWeight: "600", fontSize: 14 },
  feedTabTextActive: { color: "#fff", fontWeight: "800" },

  // Compose row
  composeRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    marginHorizontal: 16, marginBottom: 6, marginTop: 2,
    backgroundColor: "#141414", borderRadius: 18,
    padding: 12, paddingRight: 14,
    borderWidth: 1, borderColor: "#222",
  },
  composePlaceholder: { flex: 1 },
  composePlaceholderText: { color: "#3a3a3a", fontSize: 14, fontWeight: "500" },
  composeScoreBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "rgba(245,158,11,0.1)",
    alignItems: "center", justifyContent: "center",
  },

  // Empty state
  emptyContainer: { flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, paddingTop: 80, gap: 14 },
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "#141414", borderWidth: 1, borderColor: "#222",
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "800", textAlign: "center" },
  emptySub: { color: "#555", fontSize: 14, textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    marginTop: 4, flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#06b6d4", borderRadius: 14, paddingHorizontal: 22, paddingVertical: 12,
  },
  emptyBtnText: { color: "#000", fontWeight: "900", fontSize: 14 },

  // Post card
  postCard: {
    paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#181818",
  },
  postCardOfficial: { backgroundColor: "rgba(6,182,212,0.03)" },

  postHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  postMeta: { flex: 1 },
  postAuthorRow2: { flexDirection: "row", alignItems: "center", gap: 7 },
  postAuthor: { color: "#fff", fontSize: 15, fontWeight: "800" },
  officialTag: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(6,182,212,0.1)", borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  officialTagText: { color: "#06b6d4", fontSize: 10, fontWeight: "800" },
  postTime: { color: "#444", fontSize: 12, marginTop: 2 },

  // Score block inside post
  scoreBlock: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(245,158,11,0.07)",
    borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.15)",
    marginBottom: 12,
  },
  scoreBlockLabel: {
    color: "#f59e0b", fontSize: 10, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 3,
  },
  scoreBlockValue: { color: "#fff", fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
  scoreBlockRight: { alignItems: "flex-end", gap: 6 },
  trophyCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(245,158,11,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  scoreBlockGame: { color: "#f59e0b", fontSize: 11, fontWeight: "700" },

  postContent: { color: "#c8c8c8", fontSize: 15, lineHeight: 22, marginBottom: 12 },

  postFooter: { flexDirection: "row", gap: 18, paddingTop: 6 },
  likeBtn: { flexDirection: "row", alignItems: "center", gap: 7 },
  likeIconWrap: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: "#161616", alignItems: "center", justifyContent: "center",
  },
  likeIconWrapActive: { backgroundColor: "rgba(239,68,68,0.12)" },
  likeCount: { color: "#555", fontSize: 13, fontWeight: "600" },
  likeCountActive: { color: "#ef4444" },

  // Create post modal
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "flex-end" },
  modalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  modalSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: Platform.OS === "ios" ? 36 : 24,
    borderTopWidth: 1, borderColor: "#222",
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 20 },
  modalTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  postAuthorRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  postAuthorName: { color: "#fff", fontWeight: "800", fontSize: 15 },
  postAudienceLabel: { color: "#444", fontSize: 11, marginTop: 2 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "#1e1e1e", alignItems: "center", justifyContent: "center",
  },
  postInput: {
    color: "#fff", fontSize: 16, lineHeight: 24, minHeight: 100,
    textAlignVertical: "top",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#222",
    paddingBottom: 14, marginBottom: 12,
  },
  modalFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  charCount: { color: "#3a3a3a", fontSize: 12 },
  postBtn: {
    backgroundColor: "#06b6d4", borderRadius: 14,
    paddingHorizontal: 28, paddingVertical: 13,
  },
  postBtnOff: { backgroundColor: "#1a1a1a" },
  postBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },
  postErrorBox: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 10,
    padding: 10, marginBottom: 10,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
  },
  postErrorText: { color: "#ef4444", fontSize: 13, flex: 1 },

  // Photo in modal
  photoPreviewWrap: {
    borderRadius: 14, overflow: "hidden", marginBottom: 12, position: "relative",
  },
  photoPreview: { width: "100%", height: 180 },
  photoRemoveBtn: {
    position: "absolute", top: 8, right: 8,
  },
  photoPickBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center",
  },

  // Photo in post card
  postPhoto: {
    width: "100%",
    ...Platform.select({ web: { height: 400 }, default: { aspectRatio: 1 } }),
    borderRadius: 14,
    marginBottom: 12,
  },

  // Location picker modal
  locModalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "flex-end" },
  locModalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  locModalSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 36,
    borderTopWidth: 1, borderColor: "#222",
  },
  locModalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 24 },
  locModalTitle: { color: "#fff", fontSize: 18, fontWeight: "900", marginBottom: 20, letterSpacing: -0.3 },
  locModalDoneBtn: {
    backgroundColor: "#1a1a1a", borderRadius: 16,
    paddingVertical: 16, alignItems: "center",
    marginTop: 8, borderWidth: 1, borderColor: "#222",
  },
  locModalDoneBtnText: { color: "#888", fontWeight: "700", fontSize: 15 },

  // Post destination toggle (arcade officials only)
  postDestRow: {
    flexDirection: "row", gap: 8,
    marginBottom: 16, padding: 4,
    backgroundColor: "#0d0d0d", borderRadius: 12,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  postDestBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 9, borderRadius: 9,
  },
  postDestBtnActive: { backgroundColor: "#1e1e1e" },
  postDestBtnArcade: { backgroundColor: "rgba(6,182,212,0.1)" },
  postDestText: { color: "#444", fontSize: 13, fontWeight: "600" },
  postDestTextActive: { color: "#fff", fontWeight: "700" },
  postDestTextArcade: { color: "#06b6d4", fontWeight: "700" },

  postMenuBtn: {
    width: 32, height: 32, alignItems: "center", justifyContent: "center",
    borderRadius: 16, marginLeft: 4,
  },
  editModalTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },

  // Post action sheet
  menuOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  menuSheet: {
    backgroundColor: "#141414", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: "#222",
    paddingBottom: Platform.OS === "ios" ? 36 : 20, paddingTop: 8,
  },
  menuItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 22, paddingVertical: 16,
  },
  menuItemText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  menuItemDestructive: { color: "#ef4444" },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#222", marginHorizontal: 16 },
  menuCancelText: { color: "#555", fontSize: 16, fontWeight: "600" },

  // Comments
  cmtEmpty: { alignItems: "center", justifyContent: "center", paddingVertical: 36, gap: 10 },
  cmtEmptyText: { color: "#444", fontSize: 14 },
  cmtRow: { flexDirection: "row", gap: 10, paddingHorizontal: 4, marginBottom: 14, alignItems: "flex-start" },
  cmtBubble: { flex: 1, backgroundColor: "#161616", borderRadius: 14, padding: 10, borderWidth: 1, borderColor: "#1e1e1e" },
  cmtAuthor: { color: "#06b6d4", fontSize: 12, fontWeight: "800", marginBottom: 3 },
  cmtContent: { color: "#ccc", fontSize: 14, lineHeight: 20 },
  cmtInputRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#222" },
  cmtInput: { flex: 1, backgroundColor: "#161616", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, color: "#fff", fontSize: 14, borderWidth: 1, borderColor: "#222" },
  cmtSendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center" },

  // Share
  shareSubtitle: { color: "#555", fontSize: 12, marginTop: 2 },
  shareConvRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  shareConvName: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700" },
});
