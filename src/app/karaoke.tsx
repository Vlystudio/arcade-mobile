import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../context/auth-context";
import { reportError } from "../lib/report-error";
import { supabase } from "../../lib/supabase";
import { API_BASE } from "../../lib/api-base";

type QueueItem = {
  id: string;
  video_id: string;
  title: string;
  channel: string;
  thumbnail_url: string | null;
  requester_name: string;
  status: "queued" | "playing" | "played" | "skipped";
  created_at: string;
};

type SearchResult = {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
};

function extractVideoId(input: string): string | null {
  const m = input.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

export default function KaraokeScreen() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileUsername, setProfileUsername] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

  // Add song modal
  const [showAdd, setShowAdd] = useState(false);
  const [tab, setTab] = useState<"search" | "paste">("search");
  const [requesterName, setRequesterName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pasteUrl, setPasteUrl] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  // Admin: remove/skip
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      supabase
        .from("profiles")
        .select("username, role")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (data?.username) setProfileUsername(data.username);
          if (["admin", "owner", "architect"].includes(data?.role ?? "")) setIsAdmin(true);
        });
    }
    loadQueue();
    const ch = supabase
      .channel("karaoke-requests-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "karaoke_queue" }, loadQueue)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  async function loadQueue() {
    const { data } = await supabase
      .from("karaoke_queue")
      .select("id, video_id, title, channel, thumbnail_url, requester_name, status, created_at")
      .in("status", ["playing", "queued"])
      .order("created_at", { ascending: true });
    setQueue(data ?? []);
    setQueueLoading(false);
  }

  function openAddModal() {
    setShowAdd(true);
    setAddError(null);
    setSearchResults([]);
    setSearchQuery("");
    setPasteUrl("");
    setRequesterName(profileUsername);
  }

  async function handleSearch() {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      const resp = await fetch(`${API_BASE}/api/youtube/search?q=${encodeURIComponent(q)}`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setSearchResults(data.items ?? []);
    } catch (e: any) {
      const msg = e.message ?? "Search failed. Check your connection.";
      reportError("Karaoke.handleSearch", msg);
      setSearchError(msg);
    }
    setSearching(false);
  }

  async function addSong(videoId: string, title: string, channel: string, thumbnail: string) {
    const name = requesterName.trim();
    if (!name) { setAddError("Enter your name so people know who requested it."); return; }
    setAdding(videoId);
    setAddError(null);
    const { data, error } = await supabase.rpc("rpc_karaoke_add", {
      p_video_id: videoId,
      p_title: title,
      p_channel: channel,
      p_thumbnail_url: thumbnail || null,
      p_requester_name: name,
    });
    if (error) {
      reportError("Karaoke.addSong", error.message);
      setAddError(error.message);
    } else if (data?.error) {
      const msg = data.message ?? "Could not add song.";
      reportError("Karaoke.addSong", msg);
      setAddError(msg);
    } else {
      setShowAdd(false);
      setSearchResults([]);
      setSearchQuery("");
      setPasteUrl("");
    }
    setAdding(null);
  }

  async function handleAddFromUrl() {
    const videoId = extractVideoId(pasteUrl.trim());
    if (!videoId) { setAddError("Couldn't find a YouTube video ID in that URL."); return; }
    setAdding(videoId);
    setAddError(null);

    let title = "YouTube Video";
    let channel = "";
    const thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    try {
      const oe = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      );
      if (oe.ok) {
        const d = await oe.json();
        title = d.title ?? title;
        channel = d.author_name ?? "";
      }
    } catch (_) {}

    await addSong(videoId, title, channel, thumbnail);
    setAdding(null);
  }

  async function handleRemove(songId: string) {
    setRemovingId(songId);
    await supabase.rpc("rpc_karaoke_remove", { p_song_id: songId });
    setRemovingId(null);
  }

  const nowPlaying = queue.find(q => q.status === "playing") ?? null;
  const upcoming   = queue.filter(q => q.status === "queued");

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/")}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Karaoke</Text>
          <Text style={s.headerSub}>{upcoming.length} song{upcoming.length !== 1 ? "s" : ""} queued</Text>
        </View>
        <Pressable style={s.addBtn} onPress={openAddModal}>
          <Ionicons name="add" size={20} color="#000" />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>

        {/* Now Playing */}
        {nowPlaying ? (
          <View style={s.nowCard}>
            <View style={s.nowBadge}>
              <Ionicons name="musical-notes" size={11} color="#000" />
              <Text style={s.nowBadgeText}>NOW PLAYING</Text>
            </View>
            <View style={s.nowRow}>
              {nowPlaying.thumbnail_url ? (
                <Image source={{ uri: nowPlaying.thumbnail_url }} style={s.nowThumb} contentFit="cover" />
              ) : (
                <View style={[s.nowThumb, s.thumbPlaceholder]}>
                  <Ionicons name="musical-note" size={22} color="#333" />
                </View>
              )}
              <View style={s.nowInfo}>
                <Text style={s.nowTitle} numberOfLines={2}>{nowPlaying.title}</Text>
                {!!nowPlaying.channel && <Text style={s.nowChannel}>{nowPlaying.channel}</Text>}
                <Text style={s.nowRequester}>Requested by {nowPlaying.requester_name}</Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={s.emptyNow}>
            <Ionicons name="mic-outline" size={36} color="#1e1e1e" />
            <Text style={s.emptyNowText}>Nothing playing yet</Text>
            <Text style={s.emptyNowSub}>Add a song to get started</Text>
          </View>
        )}

        {/* Queue */}
        <Text style={s.sectionLabel}>UP NEXT</Text>

        {queueLoading ? (
          <ActivityIndicator color="#a855f7" style={{ marginTop: 20 }} />
        ) : upcoming.length === 0 ? (
          <View style={s.emptyQueue}>
            <Text style={s.emptyQueueText}>Queue is empty — add the first song!</Text>
          </View>
        ) : (
          upcoming.map((item, idx) => (
            <View key={item.id} style={s.queueItem}>
              <Text style={s.queuePos}>{idx + 1}</Text>
              {item.thumbnail_url ? (
                <Image source={{ uri: item.thumbnail_url }} style={s.queueThumb} contentFit="cover" />
              ) : (
                <View style={[s.queueThumb, s.thumbPlaceholder]}>
                  <Ionicons name="musical-note" size={14} color="#333" />
                </View>
              )}
              <View style={s.queueInfo}>
                <Text style={s.queueTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={s.queueMeta} numberOfLines={1}>
                  {item.channel ? `${item.channel} · ` : ""}By {item.requester_name}
                </Text>
              </View>
              {isAdmin && (
                <Pressable
                  style={s.removeBtn}
                  onPress={() => handleRemove(item.id)}
                  disabled={removingId === item.id}
                  hitSlop={8}
                >
                  {removingId === item.id
                    ? <ActivityIndicator size="small" color="#ef4444" />
                    : <Ionicons name="close-circle" size={18} color="#ef4444" />
                  }
                </Pressable>
              )}
            </View>
          ))
        )}

        {/* Display screen button */}
        <Pressable style={s.displayBtn} onPress={() => router.push("/karaoke-display" as any)}>
          <Ionicons name="tv-outline" size={15} color="#a855f7" />
          <Text style={s.displayBtnText}>Open TV / Display Screen</Text>
          <Ionicons name="open-outline" size={13} color="#a855f7" />
        </Pressable>

        {/* YouTube API Services attribution (required branding — links to YouTube) */}
        <Pressable style={s.ytAttribution} onPress={() => Linking.openURL("https://www.youtube.com")}>
          <Ionicons name="logo-youtube" size={20} color="#FF0000" />
          <Text style={s.ytAttributionText}>Video results powered by YouTube</Text>
        </Pressable>
        <View style={s.legalFooter}>
          <Pressable onPress={() => router.push("/privacy" as any)}>
            <Text style={s.legalFooterLink}>Privacy Policy</Text>
          </Pressable>
          <Text style={s.legalFooterDot}>·</Text>
          <Pressable onPress={() => router.push("/terms" as any)}>
            <Text style={s.legalFooterLink}>Terms of Service</Text>
          </Pressable>
          <Text style={s.legalFooterDot}>·</Text>
          <Pressable onPress={() => Linking.openURL("https://www.youtube.com/t/terms")}>
            <Text style={s.legalFooterLink}>YouTube Terms</Text>
          </Pressable>
          <Text style={s.legalFooterDot}>·</Text>
          <Pressable onPress={() => Linking.openURL("https://policies.google.com/privacy")}>
            <Text style={s.legalFooterLink}>Google Privacy</Text>
          </Pressable>
        </View>

      </ScrollView>

      {/* Add Song Modal */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={s.modalBg}>
            <Pressable style={s.modalDismiss} onPress={() => setShowAdd(false)} />
            <View style={s.modalSheet}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Request a Song</Text>
                <Pressable onPress={() => setShowAdd(false)}>
                  <Ionicons name="close" size={22} color="#555" />
                </Pressable>
              </View>

              {/* Request limits — match rpc_karaoke_add so a rate-limit
                  rejection never comes as a surprise */}
              <View style={s.limitNote}>
                <Ionicons name="information-circle-outline" size={14} color="#06b6d4" />
                <Text style={s.limitNoteText}>
                  {user
                    ? "You can request up to 3 songs every 10 minutes, with at most 3 of your songs waiting in the queue."
                    : "Guests share a pool of 5 queued songs. Sign in to request up to 3 songs every 10 minutes."}
                </Text>
              </View>

              {/* Requester name */}
              <TextInput
                style={s.input}
                placeholder={user ? "Your display name" : "Your name *"}
                placeholderTextColor="#555"
                value={requesterName}
                onChangeText={setRequesterName}
                maxLength={40}
              />

              {/* Tabs */}
              <View style={s.tabs}>
                <Pressable style={[s.tabBtn, tab === "search" && s.tabBtnActive]} onPress={() => setTab("search")}>
                  <Ionicons name="search" size={14} color={tab === "search" ? "#000" : "#555"} />
                  <Text style={[s.tabText, tab === "search" && s.tabTextActive]}>Search</Text>
                </Pressable>
                <Pressable style={[s.tabBtn, tab === "paste" && s.tabBtnActive]} onPress={() => setTab("paste")}>
                  <Ionicons name="link" size={14} color={tab === "paste" ? "#000" : "#555"} />
                  <Text style={[s.tabText, tab === "paste" && s.tabTextActive]}>Paste URL</Text>
                </Pressable>
              </View>

              {tab === "search" ? (
                <>
                  <View style={s.searchRow}>
                    <TextInput
                      style={[s.input, { flex: 1, marginBottom: 0 }]}
                      placeholder="Search YouTube..."
                      placeholderTextColor="#555"
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      returnKeyType="search"
                      onSubmitEditing={handleSearch}
                    />
                    <Pressable
                      style={[s.searchBtn, (!searchQuery.trim() || searching) && { opacity: 0.4 }]}
                      onPress={handleSearch}
                      disabled={!searchQuery.trim() || searching}
                    >
                      {searching
                        ? <ActivityIndicator size="small" color="#000" />
                        : <Ionicons name="search" size={18} color="#000" />
                      }
                    </Pressable>
                  </View>

                  {!!searchError && <Text style={s.errorText}>{searchError}</Text>}

                  {searchResults.length > 0 && (
                    <>
                    <Pressable style={s.ytResultsBadge} onPress={() => Linking.openURL("https://www.youtube.com")}>
                      <Ionicons name="logo-youtube" size={15} color="#FF0000" />
                      <Text style={s.ytResultsBadgeText}>Video results powered by YouTube</Text>
                    </Pressable>
                    <ScrollView style={s.resultsList} showsVerticalScrollIndicator={false}>
                      {searchResults.map(r => (
                        <View key={r.videoId} style={s.resultRow}>
                          {r.thumbnail ? (
                            <Image source={{ uri: r.thumbnail }} style={s.resultThumb} contentFit="cover" />
                          ) : (
                            <View style={[s.resultThumb, s.thumbPlaceholder]}>
                              <Ionicons name="musical-note" size={14} color="#333" />
                            </View>
                          )}
                          <View style={s.resultInfo}>
                            <Text style={s.resultTitle} numberOfLines={2}>{r.title}</Text>
                            <Text style={s.resultChannel}>{r.channel}</Text>
                          </View>
                          <Pressable
                            style={[s.addToQueueBtn, adding === r.videoId && { opacity: 0.5 }]}
                            onPress={() => addSong(r.videoId, r.title, r.channel, r.thumbnail)}
                            disabled={!!adding}
                          >
                            {adding === r.videoId
                              ? <ActivityIndicator size="small" color="#000" />
                              : <Ionicons name="add" size={18} color="#000" />
                            }
                          </Pressable>
                        </View>
                      ))}
                    </ScrollView>
                    </>
                  )}
                </>
              ) : (
                <>
                  <TextInput
                    style={s.input}
                    placeholder="https://youtube.com/watch?v=..."
                    placeholderTextColor="#555"
                    value={pasteUrl}
                    onChangeText={setPasteUrl}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                  <Pressable
                    style={[s.submitBtn, (!pasteUrl.trim() || !!adding) && { opacity: 0.4 }]}
                    onPress={handleAddFromUrl}
                    disabled={!pasteUrl.trim() || !!adding}
                  >
                    {adding
                      ? <ActivityIndicator size="small" color="#000" />
                      : <><Ionicons name="add-circle-outline" size={18} color="#000" /><Text style={s.submitBtnText}>Add to Queue</Text></>
                    }
                  </Pressable>
                </>
              )}

              {!!addError && <Text style={s.errorText}>{addError}</Text>}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#080808" },

  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1 },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "#8a8a8a", fontSize: 12 },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#a855f7", alignItems: "center", justifyContent: "center" },

  content: { padding: 20, paddingBottom: 48 },

  nowCard: { backgroundColor: "#111", borderRadius: 20, padding: 16, borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 24 },
  nowBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#a855f7", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start", marginBottom: 12 },
  nowBadgeText: { color: "#000", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  nowRow: { flexDirection: "row", gap: 12 },
  nowThumb: { width: 72, height: 72, borderRadius: 10 },
  nowInfo: { flex: 1 },
  nowTitle: { color: "#fff", fontSize: 15, fontWeight: "800", marginBottom: 4 },
  nowChannel: { color: "#666", fontSize: 12, marginBottom: 4 },
  nowRequester: { color: "#a855f7", fontSize: 12, fontWeight: "700" },

  emptyNow: { alignItems: "center", paddingVertical: 36, marginBottom: 8 },
  emptyNowText: { color: "#333", fontSize: 18, fontWeight: "900", marginTop: 12 },
  emptyNowSub: { color: "#2a2a2a", fontSize: 13, marginTop: 4 },

  sectionLabel: { color: "#777", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 12 },

  emptyQueue: { backgroundColor: "#111", borderRadius: 16, padding: 24, alignItems: "center", borderWidth: 1, borderColor: "#1e1e1e" },
  emptyQueueText: { color: "#777", fontSize: 14 },

  queueItem: { flexDirection: "row", alignItems: "center", backgroundColor: "#111", borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#1e1e1e", gap: 10 },
  queuePos: { color: "#8a8a8a", fontSize: 13, fontWeight: "900", minWidth: 20, textAlign: "center" },
  queueThumb: { width: 52, height: 52, borderRadius: 8 },
  thumbPlaceholder: { backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center" },
  queueInfo: { flex: 1 },
  queueTitle: { color: "#fff", fontSize: 14, fontWeight: "700", marginBottom: 3 },
  queueMeta: { color: "#8a8a8a", fontSize: 12 },
  removeBtn: { padding: 4 },

  displayBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 28, borderWidth: 1, borderColor: "rgba(168,85,247,0.3)", borderRadius: 14, paddingVertical: 14, backgroundColor: "rgba(168,85,247,0.06)" },
  displayBtnText: { color: "#a855f7", fontSize: 14, fontWeight: "700" },

  // Modal
  modalBg: { flex: 1, justifyContent: "flex-end" },
  modalDismiss: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  modalSheet: { backgroundColor: "#111", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: "#1e1e1e", padding: 24, paddingBottom: Platform.OS === "ios" ? 40 : 24, maxHeight: "85%" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  modalTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  limitNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 7,
    backgroundColor: "rgba(6,182,212,0.06)", borderRadius: 10,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.18)",
    paddingHorizontal: 10, paddingVertical: 8, marginBottom: 12,
  },
  limitNoteText: { flex: 1, color: "#7dd3e0", fontSize: 12, lineHeight: 17 },

  input: { backgroundColor: "#0d0d0d", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: "#fff", fontSize: 14, borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 12 },

  tabs: { flexDirection: "row", gap: 8, marginBottom: 14 },
  tabBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 12, backgroundColor: "#0d0d0d", borderWidth: 1, borderColor: "#1e1e1e" },
  tabBtnActive: { backgroundColor: "#a855f7", borderColor: "#a855f7" },
  tabText: { color: "#8a8a8a", fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: "#000" },

  searchRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  searchBtn: { width: 46, height: 46, borderRadius: 12, backgroundColor: "#a855f7", alignItems: "center", justifyContent: "center" },

  resultsList: { maxHeight: 300 },
  ytAttribution: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 12, marginTop: 14,
  },
  ytAttributionText: { color: "#888", fontSize: 12.5, fontWeight: "700" },
  legalFooter: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingBottom: 20, flexWrap: "wrap" },
  legalFooterLink: { color: "#666", fontSize: 11.5, fontWeight: "600", textDecorationLine: "underline" },
  legalFooterDot: { color: "#333", fontSize: 11.5 },
  ytResultsBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  ytResultsBadgeText: { color: "#888", fontSize: 11.5, fontWeight: "700" },

  resultRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  resultThumb: { width: 56, height: 40, borderRadius: 6 },
  resultInfo: { flex: 1 },
  resultTitle: { color: "#fff", fontSize: 13, fontWeight: "700", marginBottom: 2 },
  resultChannel: { color: "#8a8a8a", fontSize: 11 },
  addToQueueBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#a855f7", alignItems: "center", justifyContent: "center" },

  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#a855f7", borderRadius: 14, paddingVertical: 14, marginTop: 4 },
  submitBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },

  errorText: { color: "#ef4444", fontSize: 13, marginTop: 8 },
});
