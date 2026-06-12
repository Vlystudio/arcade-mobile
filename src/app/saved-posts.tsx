import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Head from "expo-router/head";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/avatar";
import { ImageLightbox } from "../components/image-lightbox";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";
import { showToast } from "../components/toast";

type SavedPost = {
  post_id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  content: string | null;
  photo_url: string | null;
  created_at: string;
  saved_at: string;
};

export default function SavedPostsScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [posts, setPosts] = useState<SavedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);

  async function load() {
    if (!user) return;
    const { data } = await supabase
      .from("saved_posts")
      .select("post_id, created_at, posts(id, user_id, content, photo_url, created_at)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    const rows = (data ?? []).filter((r: any) => r.posts);
    const userIds = [...new Set(rows.map((r: any) => {
      const p = Array.isArray(r.posts) ? r.posts[0] : r.posts;
      return p.user_id;
    }))];
    let profileMap: Record<string, { username: string; avatar_url: string | null }> = {};
    if (userIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, username, avatar_url").in("id", userIds);
      for (const p of profiles ?? []) profileMap[(p as any).id] = { username: (p as any).username, avatar_url: (p as any).avatar_url };
    }

    setPosts(rows.map((r: any) => {
      const p = Array.isArray(r.posts) ? r.posts[0] : r.posts;
      return {
        post_id: p.id,
        user_id: p.user_id,
        username: profileMap[p.user_id]?.username ?? "Unknown",
        avatar_url: profileMap[p.user_id]?.avatar_url ?? null,
        content: p.content,
        photo_url: p.photo_url,
        created_at: p.created_at,
        saved_at: r.created_at,
      };
    }));
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { if (user) load(); }, [user]);

  async function unsave(postId: string) {
    if (!user) return;
    await supabase.from("saved_posts").delete().eq("user_id", user.id).eq("post_id", postId);
    setPosts((prev) => prev.filter((p) => p.post_id !== postId));
    showToast("Removed from saved", "info");
  }

  if (authLoading || loading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Head><title>Saved Posts · ArcadeTracker</title></Head>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/profile" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Saved Posts</Text>
          <Text style={s.headerSub}>{posts.length} saved</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#06b6d4" />}
      >
        {posts.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="bookmark-outline" size={42} color="#333" />
            <Text style={s.emptyTitle}>Nothing saved yet</Text>
            <Text style={s.emptySub}>Tap the bookmark on any feed post to keep it here.</Text>
          </View>
        ) : (
          posts.map((p) => (
            <View key={p.post_id} style={s.card}>
              <View style={s.cardHeader}>
                <Pressable
                  style={s.authorRow}
                  onPress={() => router.push({ pathname: "/user-profile" as any, params: { userId: p.user_id } })}
                >
                  <Avatar uri={p.avatar_url} name={p.username} size={34} />
                  <Text style={s.author}>{p.username}</Text>
                </Pressable>
                <Pressable onPress={() => unsave(p.post_id)} hitSlop={8}>
                  <Ionicons name="bookmark" size={18} color="#f59e0b" />
                </Pressable>
              </View>
              {p.content ? <Text style={s.cardText}>{p.content}</Text> : null}
              {p.photo_url && (
                <Pressable onPress={() => setLightboxUri(p.photo_url)}>
                  <Image source={{ uri: p.photo_url }} style={s.photo} contentFit="cover" cachePolicy="none" />
                </Pressable>
              )}
            </View>
          ))
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
      <ImageLightbox uri={lightboxUri} onClose={() => setLightboxUri(null)} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "#777", fontSize: 12, marginTop: 1 },
  content: { paddingHorizontal: 18, paddingTop: 16 },

  card: {
    backgroundColor: "#0d0d0d", borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: "#1a1a1a", gap: 10,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 9, flex: 1 },
  author: { color: "#fff", fontSize: 14, fontWeight: "800" },
  cardText: { color: "#ccc", fontSize: 14.5, lineHeight: 21 },
  photo: { width: "100%", height: 220, borderRadius: 12 },

  empty: { alignItems: "center", gap: 10, paddingVertical: 72, paddingHorizontal: 32 },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  emptySub: { color: "#8a8a8a", fontSize: 13.5, textAlign: "center", lineHeight: 19 },
});
