import { pickFromCamera, pickFromLibrary } from "../../lib/pick-image";
import { compressImage, MAX_UPLOAD_BYTES } from "../../lib/compress-image";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useAdmin } from "../context/admin-context";
import {
  ActivityIndicator,
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
import { Alert } from "../../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomTabBar from "../components/bottom-tab-bar";
import { Avatar } from "../components/avatar";
import { ImageLightbox } from "../components/image-lightbox";
import { useRequireAuth } from "../hooks/use-require-auth";
import { reportError } from "../lib/report-error";
import { supabase } from "../../lib/supabase";
import { moderateText } from "../../lib/moderate-text";
import { uploadModeratedPublicImage } from "../../lib/moderated-public-media";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ReportSheet, type ReportTarget } from "../components/report-sheet";
import { MentionText } from "../components/mention-text";
import { showToast } from "../components/toast";
import { WhatsNewSheet } from "../components/whats-new";
import { fetchInbox, unseenInboxCount } from "../lib/inbox";
import { validateCommentContent, validatePostContent } from "../../lib/validation";
import { AppTour } from "../components/app-tour";
import { useTour } from "../hooks/use-tour";
import { getTourSteps } from "../../lib/tour-steps";
import type { AppRole } from "../components/role-badge";

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
  my_reaction: string | null;
  reactions: Record<string, number>;
  saved: boolean;
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

  // Reporting (shared sheet handles posts + comments)
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  // Announcement banner + new-posts pill
  const [announcement, setAnnouncement] = useState<{ id: string; title: string; body: string } | null>(null);
  const [newPostCount, setNewPostCount] = useState(0);
  const feedScrollRef = useRef<ScrollView>(null);
  const [inboxUnseen, setInboxUnseen] = useState(0);

  // Onboarding checklist for fresh accounts
  const [onboarding, setOnboarding] = useState<{ photo: boolean; team: boolean; rsvp: boolean; pick: boolean } | null>(null);

  const [userRole, setUserRole] = useState<AppRole>("user");
  const { tourVisible, dismissTour } = useTour(user?.id);

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
      const [followingRes, followersRes, friendsRes] = await Promise.all([
        supabase.from("follows").select("following_id").eq("follower_id", user.id),
        supabase.from("follows").select("follower_id").eq("following_id", user.id),
        supabase
          .from("friendships")
          .select("requester_id, addressee_id")
          .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
          .eq("status", "accepted"),
      ]);
      const friendIds = (friendsRes.data ?? []).map((f: any) =>
        f.requester_id === user.id ? f.addressee_id : f.requester_id
      );
      const ids = [
        ...new Set([
          user.id,
          ...(followingRes.data?.map((f) => f.following_id) ?? []),
          ...(followersRes.data?.map((f) => f.follower_id) ?? []),
          ...friendIds,
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

    // Step 2: parallel fetch of profiles, likes, scores, comment counts,
    // reactions, saves, and the caller's block list
    const [profilesRes, likesRes, scoresRes, commentsRes, reactionsRes, savedRes, blocksRes] = await Promise.all([
      supabase.from("profiles").select("id, username, avatar_url").in("id", userIds),
      supabase.from("post_likes").select("post_id, user_id").in("post_id", postIds),
      scoreIds.length
        ? supabase.from("scores").select("id, score, game_id, games(name)").in("id", scoreIds)
        : Promise.resolve({ data: [] }),
      supabase.from("post_comments").select("post_id").in("post_id", postIds),
      supabase.from("post_reactions").select("post_id, user_id, emoji").in("post_id", postIds),
      supabase.from("saved_posts").select("post_id").eq("user_id", user.id),
      supabase.from("user_blocks").select("blocked_id").eq("blocker_id", user.id),
    ]);

    const blockedIds = new Set((blocksRes.data ?? []).map((b: any) => b.blocked_id));
    const savedIds = new Set((savedRes.data ?? []).map((r: any) => r.post_id));
    const reactionMap: Record<string, { counts: Record<string, number>; mine: string | null }> = {};
    for (const r of reactionsRes.data ?? []) {
      const entry = (reactionMap[(r as any).post_id] ??= { counts: {}, mine: null });
      entry.counts[(r as any).emoji] = (entry.counts[(r as any).emoji] ?? 0) + 1;
      if ((r as any).user_id === user.id) entry.mine = (r as any).emoji;
    }

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

    const mapped: Post[] = postsData.filter((p: any) => !blockedIds.has(p.user_id)).map((p: any) => {
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
        my_reaction: reactionMap[p.id]?.mine ?? null,
        reactions: reactionMap[p.id]?.counts ?? {},
        saved: savedIds.has(p.id),
        created_at: p.created_at,
      };
    });

    setPosts(mapped);
    setLoading(false);
    setRefreshing(false);
  }

  async function loadProfile() {
    if (!user) return;
    const { data } = await supabase.from("profiles").select("username, avatar_url, role").eq("id", user.id).single();
    if (data) {
      setUsername(data.username);
      setMyAvatarUrl(data.avatar_url ?? null);
      setUserRole((data.role as AppRole) ?? "user");
    }
  }

  useEffect(() => {
    if (user) { loadProfile(); loadFeed(tab); loadAnnouncement(); loadInboxDot(); loadOnboarding(); }
  }, [user]);

  async function loadInboxDot() {
    if (!user) return;
    try {
      const items = await fetchInbox(user.id);
      setInboxUnseen(await unseenInboxCount(items));
    } catch {}
  }

  async function loadOnboarding() {
    if (!user) return;
    const dismissed = await AsyncStorage.getItem("onboarding_dismissed");
    if (dismissed) return;
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const weekOf = monday.toISOString().slice(0, 10);
    const [profRes, teamRes, rsvpRes, pickRes] = await Promise.all([
      supabase.from("profiles").select("avatar_url, onboarding_dismissed").eq("id", user.id).single(),
      supabase.from("team_members").select("team_id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("league_rsvps").select("user_id", { count: "exact", head: true }).eq("user_id", user.id).eq("week_of", weekOf),
      supabase.from("pickem_picks").select("user_id", { count: "exact", head: true }).eq("user_id", user.id).eq("week_of", weekOf),
    ]);
    // Dismissed on another device? Mirror it locally and stay hidden.
    if (profRes.data?.onboarding_dismissed) {
      AsyncStorage.setItem("onboarding_dismissed", "1").catch(() => {});
      return;
    }
    const state = {
      photo: !!profRes.data?.avatar_url,
      team: (teamRes.count ?? 0) > 0,
      rsvp: (rsvpRes.count ?? 0) > 0,
      pick: (pickRes.count ?? 0) > 0,
    };
    // Fully done? Never show again.
    if (Object.values(state).every(Boolean)) {
      dismissOnboarding();
      return;
    }
    setOnboarding(state);
  }

  function dismissOnboarding() {
    AsyncStorage.setItem("onboarding_dismissed", "1").catch(() => {});
    if (user) {
      supabase.from("profiles").update({ onboarding_dismissed: true }).eq("id", user.id).then(() => {});
    }
    setOnboarding(null);
  }

  async function loadAnnouncement() {
    const { data } = await supabase
      .from("app_announcements")
      .select("id, title, body")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) { setAnnouncement(null); return; }
    const dismissed = await AsyncStorage.getItem("dismissed_announcement");
    setAnnouncement(dismissed === data.id ? null : data);
  }

  function dismissAnnouncement() {
    if (announcement) AsyncStorage.setItem("dismissed_announcement", announcement.id).catch(() => {});
    setAnnouncement(null);
  }

  // New-posts pill: realtime inserts from other users bump a counter
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("feed_new_posts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, (payload: any) => {
        if (payload.new?.user_id !== user.id) setNewPostCount((n) => n + 1);
      })
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [user?.id]);


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

  async function handleReact(post: Post, emoji: string) {
    if (!user) return;
    const removing = post.my_reaction === emoji;
    if (removing) {
      await supabase.from("post_reactions").delete().eq("post_id", post.id).eq("user_id", user.id);
    } else {
      await supabase.from("post_reactions").upsert(
        { post_id: post.id, user_id: user.id, emoji },
        { onConflict: "post_id,user_id" },
      );
    }
    setPosts((prev) => prev.map((p) => {
      if (p.id !== post.id) return p;
      const counts = { ...p.reactions };
      if (p.my_reaction) counts[p.my_reaction] = Math.max((counts[p.my_reaction] ?? 1) - 1, 0);
      if (!removing) counts[emoji] = (counts[emoji] ?? 0) + 1;
      return { ...p, my_reaction: removing ? null : emoji, reactions: counts };
    }));
  }

  async function toggleSave(post: Post) {
    if (!user) return;
    if (post.saved) {
      await supabase.from("saved_posts").delete().eq("user_id", user.id).eq("post_id", post.id);
      showToast("Removed from saved", "info");
    } else {
      await supabase.from("saved_posts").insert({ user_id: user.id, post_id: post.id });
      showToast("Post saved");
    }
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, saved: !post.saved } : p)));
  }

  async function pickEditPhoto(source: "camera" | "library") {
    const asset = source === "camera"
      ? await pickFromCamera({ allowsEditing: false, quality: 0.85 })
      : await pickFromLibrary({ allowsEditing: false, quality: 0.85 });
    if (asset) { setEditPhotoUri(asset.uri); setEditPhotoRemoved(false); }
  }

  async function handleSaveEdit() {
    if (!editingPost || !user) return;
    const editText = validatePostContent(editContent);
    if (!editText.ok) {
      setEditError(editText.error);
      return;
    }
    if (!editText.value && !editPhotoUri && editPhotoRemoved && !editingPost.photo_url) {
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
        const published = await uploadModeratedPublicImage({
          ownerId: user.id,
          data: arrayBuffer,
          contentType: "image/jpeg",
          publicBucket: "post-photos",
          publicPath: path,
          recordType: "post",
          recordId: editingPost.id,
        });

        // Moderate before saving to DB — delete orphaned file if flagged
        nextPhotoUrl = published.publicUrl;
      } catch (err: any) {
        const msg = "Photo upload failed: " + (err.message ?? "unknown error");
        reportError("Feed.handleSaveEdit", msg);
        setEditError(msg);
        setEditSaving(false);
        return;
      }
    } else if (editPhotoRemoved) {
      nextPhotoUrl = null;
    }

    const updates: Record<string, any> = { content: editText.value || null };
    if (nextPhotoUrl !== undefined) updates.photo_url = nextPhotoUrl;

    const { error } = await supabase.from("posts").update(updates).eq("id", editingPost.id);
    setEditSaving(false);
    if (error) { reportError("Feed.handleSaveEdit", error.message); setEditError(error.message); return; }

    setPosts((prev) => prev.map((p) => p.id !== editingPost.id ? p : {
      ...p,
      content: editText.value || null,
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
    const postText = validatePostContent(postContent);
    if (!user || ((!postText.ok || !postText.value) && !postPhotoUri)) return;
    setPostError(null);
    if (!postText.ok) {
      setPostError(postText.error);
      return;
    }
    setPosting(true);

    if (postText.value) {
      const textMod = await moderateText(postText.value);
      if (!textMod.ok) {
        reportError("Feed.handlePost", textMod.message);
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
        const published = await uploadModeratedPublicImage({
          ownerId: user.id,
          data: arrayBuffer,
          contentType: "image/jpeg",
          publicBucket: "post-photos",
          publicPath: path,
          recordType: "post",
          recordId: "",
        });
        photoUrl = published.publicUrl;
      } catch (err: any) {
        const msg = "Photo upload failed: " + (err.message ?? "unknown error");
        reportError("Feed.handlePost", msg);
        setPostError(msg);
        setPosting(false);
        return;
      }
    }

    const { error } = await supabase.from("posts").insert({
      user_id: user.id,
      content: postText.value || null,
      post_type: isArcadeOfficial && postAsAnnouncement ? "announcement" : "post",
      photo_url: photoUrl,
    });
    setPosting(false);
    if (error) {
      console.error("[handlePost]", error.message);
      reportError("Feed.handlePost", error.message);
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
    const comment = validateCommentContent(newComment);
    if (!user || !commentPostId || !comment.ok) return;
    setCommentPosting(true);

    const mod = await moderateText(comment.value);
    if (!mod.ok) {
      Alert.alert("Comment blocked", mod.message);
      setCommentPosting(false);
      return;
    }

    const { error } = await supabase.from("post_comments").insert({
      post_id: commentPostId, user_id: user.id, content: comment.value,
    });
    setCommentPosting(false);
    if (error) { Alert.alert("Error", error.message); return; }

    setComments((prev) => [...prev, {
      id: Date.now().toString(), user_id: user.id,
      username: username ?? "You", avatar_url: myAvatarUrl,
      content: comment.value, created_at: new Date().toISOString(),
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
            <Pressable
              style={styles.iconBtn}
              onPress={() => { setInboxUnseen(0); router.push("/notifications" as any); }}
            >
              <Ionicons name="notifications-outline" size={21} color="#888" />
              {inboxUnseen > 0 && <View style={styles.bellDot} />}
            </Pressable>
            <Pressable style={styles.iconBtnCyan} onPress={() => setCreateVisible(true)}>
              <Ionicons name="add" size={20} color="#000" />
            </Pressable>
          </View>
        </View>

        {/* Broadcast announcement banner */}
        {announcement && (
          <View style={styles.broadcastBanner}>
            <Ionicons name="megaphone" size={16} color="#f59e0b" />
            <View style={{ flex: 1 }}>
              <Text style={styles.broadcastTitle}>{announcement.title}</Text>
              <Text style={styles.broadcastBody}>{announcement.body}</Text>
            </View>
            <Pressable onPress={dismissAnnouncement} hitSlop={8}>
              <Ionicons name="close" size={18} color="#777" />
            </Pressable>
          </View>
        )}

        {/* Quick composer */}
        <Pressable style={styles.quickComposer} onPress={() => setCreateVisible(true)}>
          <Avatar uri={myAvatarUrl} name={username ?? "Y"} size={34} />
          <Text style={styles.quickComposerText}>What's happening at the lanes?</Text>
          <Ionicons name="image-outline" size={18} color="#555" />
        </Pressable>

        {/* New-player onboarding checklist */}
        {onboarding && (
          <View style={styles.onboardCard}>
            <View style={styles.onboardHeader}>
              <Text style={styles.onboardTitle}>Get set for league night 🎳</Text>
              <Pressable onPress={dismissOnboarding} hitSlop={8}>
                <Ionicons name="close" size={16} color="#777" />
              </Pressable>
            </View>
            {([
              { done: onboarding.photo, label: "Add a profile photo", route: "/profile" },
              { done: onboarding.team, label: "Join (or create) a team", route: "/teams" },
              { done: onboarding.rsvp, label: "RSVP for Monday on your team page", route: "/teams" },
              { done: onboarding.pick, label: "Make your weekly Pick'em pick", route: "/leagues" },
            ] as const).map((step) => (
              <Pressable
                key={step.label}
                style={styles.onboardRow}
                onPress={() => !step.done && router.push(step.route as any)}
                disabled={step.done}
              >
                <Ionicons
                  name={step.done ? "checkmark-circle" : "ellipse-outline"}
                  size={18}
                  color={step.done ? "#22c55e" : "#555"}
                />
                <Text style={[styles.onboardLabel, step.done && styles.onboardLabelDone]}>{step.label}</Text>
                {!step.done && <Ionicons name="chevron-forward" size={13} color="#444" />}
              </Pressable>
            ))}
          </View>
        )}

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

        {newPostCount > 0 && (
          <Pressable
            style={styles.newPostsPill}
            onPress={() => {
              setNewPostCount(0);
              feedScrollRef.current?.scrollTo({ y: 0, animated: true });
              loadFeed(tab);
            }}
          >
            <Ionicons name="arrow-up" size={13} color="#000" />
            <Text style={styles.newPostsPillText}>
              {newPostCount} new {newPostCount === 1 ? "post" : "posts"}
            </Text>
          </Pressable>
        )}
        <ScrollView
          ref={feedScrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={posts.length === 0 ? styles.emptyContainer : undefined}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setNewPostCount(0); loadFeed(tab); }} tintColor="#06b6d4" />
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
                onReport={() => setReportTarget({ type: "post", id: post.id, label: `Post by ${post.username}` })}
                onUserPress={() => router.push({ pathname: "/user-profile" as any, params: { userId: post.user_id } })}
                onToggleSave={() => toggleSave(post)}
                onReact={(emoji) => handleReact(post, emoji)}
              />
            ))
          )}
        </ScrollView>
      </SafeAreaView>

      <BottomTabBar />

      <ImageLightbox uri={lightboxUri} onClose={() => setLightboxUri(null)} />
      <WhatsNewSheet />


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
                      <Pressable onPress={() => {
                        setCommentPostId(null);
                        router.push({ pathname: "/user-profile" as any, params: { userId: c.user_id } });
                      }}>
                        <Avatar uri={c.avatar_url} name={c.username} size={32} />
                      </Pressable>
                      <View style={styles.cmtBubble}>
                        <View style={styles.cmtTopRow}>
                          <Pressable style={{ flex: 1 }} onPress={() => {
                            setCommentPostId(null);
                            router.push({ pathname: "/user-profile" as any, params: { userId: c.user_id } });
                          }}>
                            <Text style={styles.cmtAuthor}>{c.username}</Text>
                          </Pressable>
                          {c.user_id !== user?.id && (
                            <Pressable
                              onPress={() => setReportTarget({ type: "comment", id: c.id, label: `Comment by ${c.username}` })}
                              hitSlop={8}
                            >
                              <Ionicons name="flag-outline" size={12} color="#444" />
                            </Pressable>
                          )}
                        </View>
                        <MentionText style={styles.cmtContent}>{c.content}</MentionText>
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
                  placeholderTextColor="#555"
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
                placeholderTextColor="#555"
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

      <ReportSheet target={reportTarget} onClose={() => setReportTarget(null)} />

      {/* Create post modal */}      {/* Create post modal */}
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
                placeholderTextColor="#555"
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

      <AppTour
        visible={tourVisible}
        steps={getTourSteps(userRole)}
        onDone={dismissTour}
      />
    </View>
  );
}

const REACTION_EMOJIS = ["\ud83d\udc4d", "\u2764\ufe0f", "\ud83d\ude02", "\ud83d\udd25", "\ud83c\udfaf", "\ud83d\ude2e"];

function PostCard({ post, isMe, canDelete, canEdit, onLike, onDelete, onEdit, onImagePress, onComment, onShare, onReport, onUserPress, onToggleSave, onReact }: {
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
  onReport: () => void;
  onUserPress: () => void;
  onToggleSave: () => void;
  onReact: (emoji: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const isAnnouncement = post.post_type === "announcement";
  const hasScore = post.score_value != null;

  return (
    <>
    <View style={[styles.postCard, isAnnouncement && styles.postCardOfficial]}>
      {/* Author row */}
      <View style={styles.postHeader}>
        <Pressable onPress={onUserPress}>
          <Avatar uri={post.avatar_url} name={post.username} size={44} />
        </Pressable>
        <View style={styles.postMeta}>
          <View style={styles.postAuthorRow2}>
            <Pressable onPress={onUserPress}>
              <Text style={styles.postAuthor}>{post.username}</Text>
            </Pressable>
            {isAnnouncement && (
              <View style={styles.officialTag}>
                <Ionicons name="shield-checkmark" size={9} color="#06b6d4" />
                <Text style={styles.officialTagText}>Official</Text>
              </View>
            )}
          </View>
          <Text style={styles.postTime}>{relTime(post.created_at)}</Text>
        </View>
        {(canEdit || canDelete || !isMe) && (
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
      {post.content ? <MentionText style={styles.postContent}>{post.content}</MentionText> : null}

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
        <Pressable style={styles.likeBtn} onPress={() => setPickerOpen((v) => !v)}>
          <View style={[styles.likeIconWrap, !!post.my_reaction && styles.likeIconWrapActive]}>
            {post.my_reaction
              ? <Text style={{ fontSize: 13 }}>{post.my_reaction}</Text>
              : <Ionicons name="happy-outline" size={16} color="#555" />}
          </View>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable style={styles.likeBtn} onPress={onToggleSave} hitSlop={6}>
          <View style={styles.likeIconWrap}>
            <Ionicons
              name={post.saved ? "bookmark" : "bookmark-outline"}
              size={15}
              color={post.saved ? "#f59e0b" : "#555"}
            />
          </View>
        </Pressable>
      </View>

      {/* Emoji picker row */}
      {pickerOpen && (
        <View style={styles.reactionPicker}>
          {REACTION_EMOJIS.map((e) => (
            <Pressable
              key={e}
              style={[styles.reactionPickBtn, post.my_reaction === e && styles.reactionPickBtnActive]}
              onPress={() => { setPickerOpen(false); onReact(e); }}
            >
              <Text style={{ fontSize: 20 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Reaction counts */}
      {Object.values(post.reactions).some((n) => n > 0) && (
        <View style={styles.reactionRow}>
          {Object.entries(post.reactions).filter(([, n]) => n > 0).map(([emoji, n]) => (
            <Pressable
              key={emoji}
              style={[styles.reactionChip, post.my_reaction === emoji && styles.reactionChipMine]}
              onPress={() => onReact(emoji)}
            >
              <Text style={{ fontSize: 12 }}>{emoji}</Text>
              <Text style={styles.reactionChipCount}>{n}</Text>
            </Pressable>
          ))}
        </View>
      )}
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
          {!isMe && (
            <Pressable style={styles.menuItem} onPress={() => { setMenuOpen(false); onReport(); }}>
              <Ionicons name="flag-outline" size={16} color="#f59e0b" />
              <Text style={styles.menuItemText}>Report Post</Text>
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
  locationPromptText: { color: "#777", fontSize: 11, fontWeight: "600" },
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
  composePlaceholderText: { color: "#6b6b6b", fontSize: 14, fontWeight: "500" },
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
  emptySub: { color: "#8a8a8a", fontSize: 14, textAlign: "center", lineHeight: 20 },
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
  postTime: { color: "#777", fontSize: 12, marginTop: 2 },

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
  likeCount: { color: "#8a8a8a", fontSize: 13, fontWeight: "600" },
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
  postAudienceLabel: { color: "#777", fontSize: 11, marginTop: 2 },
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
  charCount: { color: "#6b6b6b", fontSize: 12 },
  postBtn: {
    backgroundColor: "#06b6d4", borderRadius: 14,
    paddingHorizontal: 28, paddingVertical: 13,
  },
  postBtnOff: { backgroundColor: "#1a1a1a" },
  postBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },

  reportPrompt: { color: "#888", fontSize: 13, marginBottom: 12 },
  reportOption: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  reportRadio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: "#333",
    alignItems: "center", justifyContent: "center",
  },
  reportRadioActive: { borderColor: "#06b6d4" },
  reportRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#06b6d4" },
  reportOptionText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  reportDetailsInput: { minHeight: 70, marginTop: 12 },
  reportSubmitBtn: { alignItems: "center", marginTop: 4 },
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
  postDestText: { color: "#777", fontSize: 13, fontWeight: "600" },
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
  menuCancelText: { color: "#8a8a8a", fontSize: 16, fontWeight: "600" },

  // Comments
  cmtEmpty: { alignItems: "center", justifyContent: "center", paddingVertical: 36, gap: 10 },
  cmtEmptyText: { color: "#777", fontSize: 14 },
  bellDot: {
    position: "absolute", top: 6, right: 6,
    width: 9, height: 9, borderRadius: 5, backgroundColor: "#ef4444",
    borderWidth: 1.5, borderColor: "#0a0a0a",
  },
  quickComposer: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#0d0d0d", borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 11,
    marginHorizontal: 16, marginBottom: 10,
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  quickComposerText: { flex: 1, color: "#555", fontSize: 14 },
  onboardCard: {
    backgroundColor: "rgba(6,182,212,0.04)", borderRadius: 16,
    padding: 14, marginHorizontal: 16, marginBottom: 10,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.2)", gap: 4,
  },
  onboardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  onboardTitle: { color: "#fff", fontSize: 14, fontWeight: "800" },
  onboardRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  onboardLabel: { flex: 1, color: "#ccc", fontSize: 13.5, fontWeight: "600" },
  onboardLabelDone: { color: "#555", textDecorationLine: "line-through" },

  broadcastBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: "rgba(245,158,11,0.06)", borderRadius: 14,
    padding: 12, marginHorizontal: 16, marginBottom: 10,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.25)",
  },
  broadcastTitle: { color: "#f59e0b", fontSize: 13.5, fontWeight: "800" },
  broadcastBody: { color: "#bbb", fontSize: 12.5, lineHeight: 17, marginTop: 2 },

  newPostsPill: {
    position: "absolute", top: 108, alignSelf: "center", zIndex: 50,
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#06b6d4", borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 8,
    elevation: 6, shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8,
  },
  newPostsPillText: { color: "#000", fontSize: 12.5, fontWeight: "900" },

  reactionPicker: {
    flexDirection: "row", gap: 6, marginTop: 10,
    backgroundColor: "#0a0a0a", borderRadius: 14, padding: 8,
    borderWidth: 1, borderColor: "#222", alignSelf: "flex-start",
  },
  reactionPickBtn: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  reactionPickBtnActive: { backgroundColor: "rgba(6,182,212,0.15)" },
  reactionRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  reactionChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#161616", borderRadius: 12,
    paddingHorizontal: 9, paddingVertical: 4,
    borderWidth: 1, borderColor: "#242424",
  },
  reactionChipMine: { borderColor: "rgba(6,182,212,0.5)", backgroundColor: "rgba(6,182,212,0.1)" },
  reactionChipCount: { color: "#999", fontSize: 11.5, fontWeight: "800" },
  cmtTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },

  cmtRow: { flexDirection: "row", gap: 10, paddingHorizontal: 4, marginBottom: 14, alignItems: "flex-start" },
  cmtBubble: { flex: 1, backgroundColor: "#161616", borderRadius: 14, padding: 10, borderWidth: 1, borderColor: "#1e1e1e" },
  cmtAuthor: { color: "#06b6d4", fontSize: 12, fontWeight: "800", marginBottom: 3 },
  cmtContent: { color: "#ccc", fontSize: 14, lineHeight: 20 },
  cmtInputRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#222" },
  cmtInput: { flex: 1, backgroundColor: "#161616", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, color: "#fff", fontSize: 14, borderWidth: 1, borderColor: "#222" },
  cmtSendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center" },

  // Share
  shareSubtitle: { color: "#8a8a8a", fontSize: 12, marginTop: 2 },
  shareConvRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  shareConvName: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700" },
});
