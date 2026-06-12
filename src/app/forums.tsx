import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Head from "expo-router/head";
import { useEffect, useState } from "react";
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
import { ListSkeleton } from "../components/skeleton";
import { useRequireAuth } from "../hooks/use-require-auth";
import { reportError } from "../lib/report-error";
import { supabase } from "../../lib/supabase";
import { moderateText } from "../../lib/moderate-text";
import { isElevatedRole } from "../components/role-badge";
import { validateForumDescription, validateForumTitle } from "../../lib/validation";

const GAME_TYPES = ["All", "Skee-Ball", "Pinball", "Arcade", "Basketball", "Air Hockey", "Pool", "General"];

const TYPE_COLORS: Record<string, string> = {
  "Skee-Ball":  "#06b6d4",
  "Pinball":    "#a855f7",
  "Arcade":     "#f59e0b",
  "Basketball": "#ef4444",
  "Air Hockey": "#22c55e",
  "Pool":       "#3b82f6",
  "General":    "#94a3b8",
};

const TYPE_ICONS: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  "Skee-Ball":  "bowling-ball-outline",
  "Pinball":    "sparkles-outline",
  "Arcade":     "game-controller-outline",
  "Basketball": "basketball-outline",
  "Air Hockey": "disc-outline",
  "Pool":       "ellipse-outline",
  "General":    "chatbubbles-outline",
};

type Forum = {
  id: string;
  title: string;
  description: string | null;
  game_type: string | null;
  creator_id: string | null;
  creator_username: string;
  post_count: number;
  last_post_at: string | null;
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
  const [userRole, setUserRole] = useState<string>("user");

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
      supabase.from("forum_posts").select("forum_id, created_at").in("forum_id", forumIds),
    ]);

    const profileMap = Object.fromEntries((profilesRes.data ?? []).map((p: any) => [p.id, p.username]));
    const countMap: Record<string, number> = {};
    const lastPostMap: Record<string, string> = {};
    for (const p of postsRes.data ?? []) {
      const fid = (p as any).forum_id;
      countMap[fid] = (countMap[fid] ?? 0) + 1;
      const created = (p as any).created_at;
      if (created && (!lastPostMap[fid] || created > lastPostMap[fid])) lastPostMap[fid] = created;
    }

    setForums(forumsData.map((f: any) => ({
      id: f.id, title: f.title, description: f.description, game_type: f.game_type,
      creator_id: f.creator_id,
      creator_username: f.creator_id ? (profileMap[f.creator_id] ?? "Unknown") : "Unknown",
      post_count: countMap[f.id] ?? 0,
      last_post_at: lastPostMap[f.id] ?? null,
      created_at: f.created_at,
    })));
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (!user) return;
    loadForums();
    supabase.from("profiles").select("role").eq("id", user.id).single()
      .then(({ data }) => { if (data?.role) setUserRole(data.role); });
  }, [user]);

  async function handleCreate() {
    setSubmitError(null);
    const safeTitle = validateForumTitle(title);
    const safeDescription = validateForumDescription(description);
    if (!user || !safeTitle.ok || !safeDescription.ok) {
      setSubmitError(!safeTitle.ok ? safeTitle.error : !safeDescription.ok ? safeDescription.error : null);
      return;
    }
    setSubmitting(true);

    const mod = await moderateText(`${safeTitle.value} ${safeDescription.value}`);
    if (!mod.ok) {
      reportError("Forums.handleCreate", mod.message);
      setSubmitError(mod.message);
      setSubmitting(false);
      return;
    }

    const elevated = isElevatedRole(userRole);
    const { error } = await supabase.from("forums").insert({
      title: safeTitle.value,
      description: safeDescription.value || null,
      game_type: gameType === "General" ? null : gameType,
      creator_id: user.id,
      status: elevated ? "approved" : "pending",
    });
    setSubmitting(false);
    if (error) { reportError("Forums.handleCreate", error.message); setSubmitError(error.message); return; }

    setCreateVisible(false);
    setTitle("");
    setDescription("");
    setGameType("General");
    if (elevated) {
      loadForums();
    } else {
      Alert.alert("Forum Submitted", "Your forum request has been sent for admin approval. It will appear here once approved.");
    }
  }

  const filtered = filter === "All" ? forums : forums.filter((f) => f.game_type === filter || (!f.game_type && filter === "General"));

  // Group into category sections (real forum board style) when showing All
  const sections: { category: string; boards: Forum[] }[] = [];
  if (filter === "All") {
    const byCat: Record<string, Forum[]> = {};
    for (const f of filtered) {
      const cat = f.game_type ?? "General";
      (byCat[cat] ??= []).push(f);
    }
    for (const cat of GAME_TYPES.slice(1)) {
      if (byCat[cat]?.length) sections.push({ category: cat, boards: byCat[cat] });
    }
  } else if (filtered.length) {
    sections.push({ category: filter, boards: filtered });
  }

  if (authLoading || loading) {
    return <ListSkeleton rows={4} />;
  }

  return (
    <View style={styles.root}>
      <Head><title>Forums · ArcadeTracker</title></Head>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.pageWrap}>
          {/* Header */}
          <View style={styles.header}>
            <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/")}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Forums</Text>
              <Text style={styles.headerSub}>
                {forums.length} {forums.length === 1 ? "board" : "boards"} · {forums.reduce((a, f) => a + f.post_count, 0)} posts
              </Text>
            </View>
            <Pressable style={styles.createBtn} onPress={() => setCreateVisible(true)}>
              <Ionicons name="add" size={16} color="#000" />
              <Text style={styles.createBtnText}>New Board</Text>
            </Pressable>
          </View>

          {/* Filter chips */}
          <View style={styles.filterWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {GAME_TYPES.map((g) => (
                <Pressable
                  key={g}
                  style={[styles.filterChip, filter === g && styles.filterChipActive]}
                  onPress={() => setFilter(g)}
                >
                  {g !== "All" && (
                    <View style={[styles.filterDot, { backgroundColor: TYPE_COLORS[g] ?? "#555" }]} />
                  )}
                  <Text style={[styles.filterChipText, filter === g && styles.filterChipTextActive]}>{g}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={sections.length === 0 ? styles.emptyContainer : styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadForums(); }} tintColor="#06b6d4" />}
          >
            {sections.length === 0 ? (
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="chatbubbles-outline" size={36} color="#333" />
                </View>
                <Text style={styles.emptyTitle}>No boards yet</Text>
                <Text style={styles.emptySub}>Be the first to create a discussion board for this game.</Text>
                <Pressable style={styles.emptyBtn} onPress={() => setCreateVisible(true)}>
                  <Ionicons name="add" size={14} color="#000" />
                  <Text style={styles.emptyBtnText}>Create Board</Text>
                </Pressable>
              </View>
            ) : (
              sections.map((section) => {
                const color = TYPE_COLORS[section.category] ?? "#94a3b8";
                return (
                  <View key={section.category} style={styles.section}>
                    {/* Category header */}
                    <View style={styles.sectionHeader}>
                      <View style={[styles.sectionStripe, { backgroundColor: color }]} />
                      <Text style={styles.sectionTitle}>{section.category}</Text>
                      <Text style={styles.sectionCount}>
                        {section.boards.length} {section.boards.length === 1 ? "board" : "boards"}
                      </Text>
                    </View>

                    {/* Board rows */}
                    <View style={styles.boardCard}>
                      {section.boards.map((forum, i) => (
                        <Pressable
                          key={forum.id}
                          style={({ pressed }) => [
                            styles.boardRow,
                            i < section.boards.length - 1 && styles.boardRowDivider,
                            pressed && { backgroundColor: "rgba(255,255,255,0.02)" },
                          ]}
                          onPress={() => router.push({ pathname: "/forum-detail", params: { forumId: forum.id, title: forum.title } } as any)}
                        >
                          <View style={[styles.boardIcon, { backgroundColor: `${color}14`, borderColor: `${color}30` }]}>
                            <Ionicons name={TYPE_ICONS[section.category] ?? "chatbubbles-outline"} size={19} color={color} />
                          </View>

                          <View style={styles.boardInfo}>
                            <Text style={styles.boardTitle} numberOfLines={1}>{forum.title}</Text>
                            {forum.description ? (
                              <Text style={styles.boardDesc} numberOfLines={2}>{forum.description}</Text>
                            ) : null}
                            <Text style={styles.boardByline}>
                              by {forum.creator_username} · created {relTime(forum.created_at)}
                            </Text>
                          </View>

                          {/* Stats column */}
                          <View style={styles.boardStats}>
                            <Text style={styles.boardStatNum}>{forum.post_count}</Text>
                            <Text style={styles.boardStatLabel}>{forum.post_count === 1 ? "post" : "posts"}</Text>
                            <Text style={styles.boardActivity}>
                              {forum.last_post_at ? `active ${relTime(forum.last_post_at)}` : "no activity"}
                            </Text>
                          </View>

                          <Ionicons name="chevron-forward" size={15} color="#2e2e2e" />
                        </Pressable>
                      ))}
                    </View>
                  </View>
                );
              })
            )}
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
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
                <Text style={styles.modalTitle}>Create Board</Text>
                <Pressable style={styles.modalCloseBtn} onPress={() => setCreateVisible(false)}>
                  <Ionicons name="close" size={18} color="#555" />
                </Pressable>
              </View>
              {!isElevatedRole(userRole) && (
                <Text style={styles.pendingNote}>
                  <Ionicons name="information-circle-outline" size={13} color="#f59e0b" />
                  {"  "}Boards require admin approval before going live.
                </Text>
              )}

              <Text style={styles.fieldLabel}>Title *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Skee-Ball Tips & Tricks"
                placeholderTextColor="#555"
                value={title}
                onChangeText={(t) => { setTitle(t); setSubmitError(null); }}
                maxLength={80}
              />

              <Text style={styles.fieldLabel}>Description (optional)</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                placeholder="What will this board be about?"
                placeholderTextColor="#555"
                value={description}
                onChangeText={setDescription}
                multiline
                maxLength={300}
              />

              <Text style={styles.fieldLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16, flexGrow: 0 }}>
                <View style={styles.gameTypeRow}>
                  {GAME_TYPES.slice(1).map((g) => (
                    <Pressable
                      key={g}
                      style={[styles.gameTypeChip, gameType === g && styles.gameTypeChipActive]}
                      onPress={() => setGameType(g)}
                    >
                      <View style={[styles.filterDot, { backgroundColor: TYPE_COLORS[g] ?? "#555" }]} />
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
                  : <Text style={styles.submitBtnText}>
                      {isElevatedRole(userRole) ? "Create Board" : "Submit for Approval"}
                    </Text>}
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
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
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
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "900", letterSpacing: -0.3 },
  headerSub: { color: "#4a4a4a", fontSize: 12, marginTop: 2 },
  createBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#06b6d4", borderRadius: 10,
    paddingHorizontal: 13, paddingVertical: 8,
  },
  createBtnText: { color: "#000", fontWeight: "800", fontSize: 13 },

  // flexGrow:0 keeps the horizontal scroller from stretching vertically on web
  filterWrap: { flexGrow: 0 },
  filterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8, alignItems: "center" },
  filterChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 13, paddingVertical: 7, borderRadius: 20,
    backgroundColor: "#141414", borderWidth: 1, borderColor: "#222",
  },
  filterChipActive: { backgroundColor: "rgba(6,182,212,0.12)", borderColor: "#06b6d4" },
  filterChipText: { color: "#666", fontSize: 13, fontWeight: "600" },
  filterChipTextActive: { color: "#06b6d4", fontWeight: "700" },
  filterDot: { width: 7, height: 7, borderRadius: 4 },

  emptyContainer: { flexGrow: 1 },
  list: { paddingHorizontal: 16, paddingTop: 4 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#141414", borderWidth: 1, borderColor: "#222", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  emptySub: { color: "#8a8a8a", fontSize: 14, textAlign: "center", lineHeight: 20 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#06b6d4", borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12 },
  emptyBtnText: { color: "#000", fontWeight: "900", fontSize: 14 },

  // ── Category sections ──
  section: { marginBottom: 22 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 9, paddingHorizontal: 2 },
  sectionStripe: { width: 3.5, height: 15, borderRadius: 2 },
  sectionTitle: { color: "#e8e8e8", fontSize: 14.5, fontWeight: "800", letterSpacing: -0.2, flex: 1 },
  sectionCount: { color: "#6b6b6b", fontSize: 11.5, fontWeight: "600" },

  // ── Board rows ──
  boardCard: {
    backgroundColor: "#101010", borderRadius: 16,
    borderWidth: 1, borderColor: "#1c1c1c",
    overflow: "hidden",
  },
  boardRow: {
    flexDirection: "row", alignItems: "center", gap: 13,
    paddingHorizontal: 15, paddingVertical: 14,
  },
  boardRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1c1c1c" },
  boardIcon: {
    width: 42, height: 42, borderRadius: 12,
    borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  boardInfo: { flex: 1, gap: 2, minWidth: 0 },
  boardTitle: { color: "#fff", fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  boardDesc: { color: "#5e5e5e", fontSize: 12.5, lineHeight: 17 },
  boardByline: { color: "#383838", fontSize: 11, marginTop: 1 },
  boardStats: { alignItems: "flex-end", minWidth: 64, gap: 0 },
  boardStatNum: { color: "#e8e8e8", fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
  boardStatLabel: { color: "#777", fontSize: 10.5, fontWeight: "600", marginTop: -1 },
  boardActivity: { color: "#06b6d4", fontSize: 10.5, fontWeight: "600", marginTop: 4, opacity: 0.75 },

  // ── Modal ──
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "flex-end" },
  modalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  modalSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: Platform.OS === "ios" ? 36 : 24,
    borderTopWidth: 1, borderColor: "#222",
    width: "100%", maxWidth: 560, alignSelf: "center",
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
  fieldLabel: { color: "#8a8a8a", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  input: {
    backgroundColor: "#0d0d0d", borderRadius: 14,
    borderWidth: 1, borderColor: "#222",
    paddingHorizontal: 14, paddingVertical: 12,
    color: "#fff", fontSize: 15, marginBottom: 16,
  },
  inputMulti: { minHeight: 80, textAlignVertical: "top" },
  gameTypeRow: { flexDirection: "row", gap: 8 },
  gameTypeChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    backgroundColor: "#1a1a1a", borderWidth: 1, borderColor: "#222",
  },
  gameTypeChipActive: { backgroundColor: "rgba(6,182,212,0.12)", borderColor: "#06b6d4" },
  gameTypeChipText: { color: "#8a8a8a", fontSize: 13, fontWeight: "600" },
  gameTypeChipTextActive: { color: "#06b6d4", fontWeight: "700" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },
  submitBtn: { backgroundColor: "#06b6d4", borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  submitBtnOff: { backgroundColor: "#1a1a1a" },
  submitBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },
});
