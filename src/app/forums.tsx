import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
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
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

const GAME_TYPES = ["All", "Skee-Ball", "Pinball", "Arcade", "Basketball", "Air Hockey", "Pool", "General"];
const MOD_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";

type Forum = {
  id: string;
  title: string;
  description: string | null;
  game_type: string | null;
  creator_id: string | null;
  creator_username: string;
  post_count: number;
  created_at: string;
};

export default function ForumsScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [forums, setForums] = useState<Forum[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("All");
  const [createVisible, setCreateVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [gameType, setGameType] = useState("General");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function loadForums() {
    const { data: forumsData } = await supabase
      .from("forums")
      .select("id, title, description, game_type, creator_id, created_at")
      .eq("status", "approved")
      .order("created_at", { ascending: false });

    if (!forumsData?.length) { setForums([]); setLoading(false); setRefreshing(false); return; }

    const creatorIds = [...new Set(forumsData.map((f: any) => f.creator_id).filter(Boolean))];
    const forumIds = forumsData.map((f: any) => f.id);

    const [profilesRes, postsRes] = await Promise.all([
      creatorIds.length
        ? supabase.from("profiles").select("id, username").in("id", creatorIds)
        : Promise.resolve({ data: [] }),
      supabase.from("forum_posts").select("forum_id").in("forum_id", forumIds),
    ]);

    const profileMap = Object.fromEntries((profilesRes.data ?? []).map((p: any) => [p.id, p.username]));
    const countMap: Record<string, number> = {};
    for (const p of postsRes.data ?? []) countMap[(p as any).forum_id] = (countMap[(p as any).forum_id] ?? 0) + 1;

    setForums(forumsData.map((f: any) => ({
      id: f.id, title: f.title, description: f.description, game_type: f.game_type,
      creator_id: f.creator_id,
      creator_username: f.creator_id ? (profileMap[f.creator_id] ?? "Unknown") : "Unknown",
      post_count: countMap[f.id] ?? 0,
      created_at: f.created_at,
    })));
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { if (user) loadForums(); }, [user]);

  async function handleCreate() {
    if (!user || !title.trim()) return;
    setSubmitError(null);
    setSubmitting(true);

    try {
      const modRes = await fetch(`${MOD_BASE}/api/moderation/text`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `${title} ${description}` }),
      });
      if (modRes.ok) {
        const { flagged, reason } = await modRes.json();
        if (flagged) {
          setSubmitError(reason ?? "Content flagged by moderation.");
          setSubmitting(false);
          return;
        }
      }
    } catch {}

    const { error } = await supabase.from("forums").insert({
      title: title.trim(),
      description: description.trim() || null,
      game_type: gameType === "General" ? null : gameType,
      creator_id: user.id,
      status: "pending",
    });
    setSubmitting(false);
    if (error) { setSubmitError(error.message); return; }

    setCreateVisible(false);
    setTitle("");
    setDescription("");
    setGameType("General");
    Alert.alert("Forum Submitted", "Your forum request has been sent for admin approval. It will appear here once approved.");
  }

  const filtered = filter === "All" ? forums : forums.filter((f) => f.game_type === filter || (!f.game_type && filter === "General"));

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/")}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Forums</Text>
            <Text style={styles.headerSub}>Game discussion boards</Text>
          </View>
          <Pressable style={styles.createBtn} onPress={() => setCreateVisible(true)}>
            <Ionicons name="add" size={18} color="#000" />
            <Text style={styles.createBtnText}>New</Text>
          </Pressable>
        </View>

        {/* Filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {GAME_TYPES.map((g) => (
            <Pressable
              key={g}
              style={[styles.filterChip, filter === g && styles.filterChipActive]}
              onPress={() => setFilter(g)}
            >
              <Text style={[styles.filterChipText, filter === g && styles.filterChipTextActive]}>{g}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadForums(); }} tintColor="#06b6d4" />}
        >
          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="chatbubbles-outline" size={36} color="#333" />
              </View>
              <Text style={styles.emptyTitle}>No forums yet</Text>
              <Text style={styles.emptySub}>Be the first to create a discussion board for this game.</Text>
              <Pressable style={styles.emptyBtn} onPress={() => setCreateVisible(true)}>
                <Ionicons name="add" size={14} color="#000" />
                <Text style={styles.emptyBtnText}>Create Forum</Text>
              </Pressable>
            </View>
          ) : (
            filtered.map((forum) => (
              <Pressable
                key={forum.id}
                style={styles.forumCard}
                onPress={() => router.push({ pathname: "/forum-detail", params: { forumId: forum.id, title: forum.title } } as any)}
              >
                <View style={styles.forumCardTop}>
                  <View style={styles.forumIconWrap}>
                    <Ionicons name="chatbubbles" size={20} color="#06b6d4" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.forumTitle} numberOfLines={1}>{forum.title}</Text>
                    {forum.description ? (
                      <Text style={styles.forumDesc} numberOfLines={2}>{forum.description}</Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#333" />
                </View>
                <View style={styles.forumMeta}>
                  {forum.game_type && (
                    <View style={styles.gameChip}>
                      <Text style={styles.gameChipText}>{forum.game_type}</Text>
                    </View>
                  )}
                  <Text style={styles.forumMetaText}>
                    {forum.post_count} {forum.post_count === 1 ? "post" : "posts"} · by {forum.creator_username}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      </SafeAreaView>

      <BottomTabBar />

      {/* Create Forum modal */}
      <Modal visible={createVisible} transparent animationType="slide" onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalBg}>
            <Pressable style={styles.modalDismiss} onPress={() => setCreateVisible(false)} />
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>Create Forum</Text>
                <Pressable style={styles.modalCloseBtn} onPress={() => setCreateVisible(false)}>
                  <Ionicons name="close" size={18} color="#555" />
                </Pressable>
              </View>
              <Text style={styles.pendingNote}>
                <Ionicons name="information-circle-outline" size={13} color="#f59e0b" />
                {"  "}Forums require admin approval before going live.
              </Text>

              <Text style={styles.fieldLabel}>Title *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Skee-Ball Tips & Tricks"
                placeholderTextColor="#333"
                value={title}
                onChangeText={(t) => { setTitle(t); setSubmitError(null); }}
                maxLength={80}
              />

              <Text style={styles.fieldLabel}>Description (optional)</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                placeholder="What will this forum be about?"
                placeholderTextColor="#333"
                value={description}
                onChangeText={setDescription}
                multiline
                maxLength={300}
              />

              <Text style={styles.fieldLabel}>Game Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <View style={styles.gameTypeRow}>
                  {GAME_TYPES.map((g) => (
                    <Pressable
                      key={g}
                      style={[styles.gameTypeChip, gameType === g && styles.gameTypeChipActive]}
                      onPress={() => setGameType(g)}
                    >
                      <Text style={[styles.gameTypeChipText, gameType === g && styles.gameTypeChipTextActive]}>{g}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              {submitError && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
                  <Text style={styles.errorText}>{submitError}</Text>
                </View>
              )}

              <Pressable
                style={[styles.submitBtn, (!title.trim() || submitting) && styles.submitBtnOff]}
                onPress={handleCreate}
                disabled={!title.trim() || submitting}
              >
                {submitting
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Text style={styles.submitBtnText}>Submit for Approval</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
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
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "#444", fontSize: 12, marginTop: 1 },
  createBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#06b6d4", borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  createBtnText: { color: "#000", fontWeight: "800", fontSize: 13 },

  filterRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: "#141414", borderWidth: 1, borderColor: "#222",
  },
  filterChipActive: { backgroundColor: "rgba(6,182,212,0.12)", borderColor: "#06b6d4" },
  filterChipText: { color: "#555", fontSize: 13, fontWeight: "600" },
  filterChipTextActive: { color: "#06b6d4", fontWeight: "700" },

  emptyContainer: { flex: 1 },
  list: { padding: 16, paddingBottom: 40 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#141414", borderWidth: 1, borderColor: "#222", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  emptySub: { color: "#555", fontSize: 14, textAlign: "center", lineHeight: 20 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#06b6d4", borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12 },
  emptyBtnText: { color: "#000", fontWeight: "900", fontSize: 14 },

  forumCard: {
    backgroundColor: "#111", borderRadius: 18,
    borderWidth: 1, borderColor: "#1e1e1e",
    padding: 16, marginBottom: 10,
  },
  forumCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 10 },
  forumIconWrap: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: "rgba(6,182,212,0.08)", borderWidth: 1, borderColor: "rgba(6,182,212,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  forumTitle: { color: "#fff", fontSize: 15, fontWeight: "800", marginBottom: 3 },
  forumDesc: { color: "#555", fontSize: 13, lineHeight: 18 },
  forumMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  gameChip: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
    backgroundColor: "rgba(6,182,212,0.1)", borderWidth: 1, borderColor: "rgba(6,182,212,0.2)",
  },
  gameChipText: { color: "#06b6d4", fontSize: 11, fontWeight: "700" },
  forumMetaText: { color: "#444", fontSize: 12 },

  // Modal
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "flex-end" },
  modalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  modalSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: Platform.OS === "ios" ? 36 : 24,
    borderTopWidth: 1, borderColor: "#222",
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 20 },
  modalTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#1e1e1e", alignItems: "center", justifyContent: "center" },
  pendingNote: {
    color: "#f59e0b", fontSize: 12, lineHeight: 18,
    backgroundColor: "rgba(245,158,11,0.08)", borderRadius: 10,
    padding: 10, marginBottom: 16,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
  },
  fieldLabel: { color: "#555", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  input: {
    backgroundColor: "#0d0d0d", borderRadius: 14,
    borderWidth: 1, borderColor: "#222",
    paddingHorizontal: 14, paddingVertical: 12,
    color: "#fff", fontSize: 15, marginBottom: 16,
  },
  inputMulti: { minHeight: 80, textAlignVertical: "top" },
  gameTypeRow: { flexDirection: "row", gap: 8 },
  gameTypeChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: "#1a1a1a", borderWidth: 1, borderColor: "#222" },
  gameTypeChipActive: { backgroundColor: "rgba(6,182,212,0.12)", borderColor: "#06b6d4" },
  gameTypeChipText: { color: "#555", fontSize: 13, fontWeight: "600" },
  gameTypeChipTextActive: { color: "#06b6d4", fontWeight: "700" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },
  submitBtn: { backgroundColor: "#06b6d4", borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  submitBtnOff: { backgroundColor: "#1a1a1a" },
  submitBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },
});
