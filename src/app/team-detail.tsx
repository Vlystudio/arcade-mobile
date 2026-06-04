import { pickFromCamera, pickFromLibrary } from "../../lib/pick-image";
import { Image } from "expo-image";
import { Avatar } from "../components/avatar";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { moderateText } from "../../lib/moderate-text";
import { useRequireAuth } from "../hooks/use-require-auth";

const SLOTS = ["6:00 PM", "7:15 PM", "8:30 PM"] as const;
type SlotTime = typeof SLOTS[number];

type Announcement = {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  content: string;
  created_at: string;
};

const SEASON_WEEKS = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SEASON_MS = SEASON_WEEKS * WEEK_MS;

type Member = { user_id: string; username: string; role: string; avatar_url: string | null };
type ScoreRow = { id: string; user_id: string; score: number; created_at: string; game_type: string | null };
type ComputedSeason = { id: string; label: string; startMs: number; endMs: number };

type PlayerStats = {
  user_id: string;
  username: string;
  role: string;
  avatar_url: string | null;
  games: number;
  avg: number;
  best: number;
  bestWeekAvg: number | null;
  worstWeekAvg: number | null;
};

function isoWeekKey(d: Date): string {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const y = new Date(t.getFullYear(), 0, 4);
  const w = 1 + Math.round(((t.getTime() - y.getTime()) / 86400000 - 3 + ((y.getDay() + 6) % 7)) / 7);
  return `${t.getFullYear()}-W${w.toString().padStart(2, "0")}`;
}

function weeklyAvgs(scores: ScoreRow[]): number[] {
  const map: Record<string, number[]> = {};
  for (const s of scores) {
    const k = isoWeekKey(new Date(s.created_at));
    (map[k] ??= []).push(s.score);
  }
  return Object.values(map).map((arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length));
}

export default function TeamDetailScreen() {
  const { teamId, teamName } = useLocalSearchParams<{ teamId: string; teamName: string }>();
  const { user } = useRequireAuth();

  const [members, setMembers] = useState<Member[]>([]);
  const [allScores, setAllScores] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCaptain, setIsCaptain] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [photoSourceVisible, setPhotoSourceVisible] = useState(false);
  const [selectedId, setSelectedId] = useState("all");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Slot preferences
  const [slotPref1, setSlotPref1] = useState<string | null>(null);
  const [slotPref2, setSlotPref2] = useState<string | null>(null);
  const [editSlotsVisible, setEditSlotsVisible] = useState(false);
  const [editSlot1, setEditSlot1] = useState<string | null>(null);
  const [editSlot2, setEditSlot2] = useState<string | null>(null);
  const [savingSlots, setSavingSlots] = useState(false);

  // Announcements
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [newAnnouncement, setNewAnnouncement] = useState("");
  const [postingAnnouncement, setPostingAnnouncement] = useState(false);
  const [announceVisible, setAnnounceVisible] = useState(false);

  async function loadData() {
    if (!teamId || !user) return;

    const [membersRes, teamRes, profileRes] = await Promise.all([
      supabase.from("team_members").select("user_id, role, profiles(username, avatar_url)").eq("team_id", teamId),
      supabase.from("teams").select("captain_user_id, photo_url, slot_pref_1, slot_pref_2").eq("id", teamId).single(),
      supabase.from("profiles").select("role").eq("id", user.id).single(),
    ]);

    const memberList: Member[] = (membersRes.data ?? []).map((m: any) => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return { user_id: m.user_id, role: m.role, username: p?.username ?? "Unknown", avatar_url: p?.avatar_url ?? null };
    });
    setMembers(memberList);
    const isCaptainByTeam = teamRes.data?.captain_user_id === user.id;
    const isCaptainByRole = memberList.some((m) => m.user_id === user.id && m.role === "captain");
    setIsCaptain(isCaptainByTeam || isCaptainByRole);
    const r = (profileRes.data as any)?.role ?? "user";
    setIsAdmin(r === "admin" || r === "owner" || r === "architect");
    setPhotoUrl((teamRes.data as any)?.photo_url ?? null);
    setSlotPref1((teamRes.data as any)?.slot_pref_1 ?? null);
    setSlotPref2((teamRes.data as any)?.slot_pref_2 ?? null);

    // Load announcements
    setAnnouncementsLoading(true);
    const { data: annData } = await supabase
      .from("team_announcements")
      .select("id, user_id, content, created_at")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .limit(10);
    const annUserIds = [...new Set((annData ?? []).map((a: any) => a.user_id as string))];
    let annProfileMap: Record<string, { username: string; avatar_url: string | null }> = {};
    if (annUserIds.length) {
      const { data: ap } = await supabase.from("profiles").select("id, username, avatar_url").in("id", annUserIds);
      for (const p of ap ?? []) annProfileMap[(p as any).id] = { username: (p as any).username, avatar_url: (p as any).avatar_url };
    }
    setAnnouncements((annData ?? []).map((a: any) => ({
      id: a.id, user_id: a.user_id,
      username: annProfileMap[a.user_id]?.username ?? "Unknown",
      avatar_url: annProfileMap[a.user_id]?.avatar_url ?? null,
      content: a.content, created_at: a.created_at,
    })));
    setAnnouncementsLoading(false);

    if (memberList.length > 0) {
      const { data } = await supabase
        .from("scores")
        .select("id, user_id, score, created_at, games(type)")
        .in("user_id", memberList.map((m) => m.user_id))
        .eq("status", "approved")
        .order("created_at", { ascending: true });
      const skeeball = (data ?? [])
        .map((s: any) => {
          const g = Array.isArray(s.games) ? s.games[0] : s.games;
          return { ...s, game_type: g?.type ?? null };
        })
        .filter((s) => s.game_type === "skeeball");
      setAllScores(skeeball);
    }
    setLoading(false);
  }

  async function pickTeamPhoto(source: "camera" | "library" = "camera") {
    if (!user || !teamId) return;
    const asset = source === "camera"
      ? await pickFromCamera({ allowsEditing: true, aspect: [1, 1], quality: 0.8 })
      : await pickFromLibrary({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!asset) return;

    setUploadingPhoto(true);
    try {
      const mimeType = asset.mimeType ?? "image/jpeg";
      const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";

      // Read via FileReader → ArrayBuffer (more reliable than blob in React Native)
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      if (!blob || blob.size === 0) throw new Error("Image file appears empty — try a different photo");

      const arrayBuffer: ArrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(new Error("Failed to read image data"));
        reader.readAsArrayBuffer(blob);
      });

      const path = `${teamId}/photo.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("team-photos")
        .upload(path, arrayBuffer, { upsert: true, contentType: mimeType });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("team-photos").getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      let finalUrl = publicUrl;

      const urlCheck = await fetch(publicUrl, { method: "HEAD" }).catch(() => null);

      if (!urlCheck?.ok) {
        // Bucket is private — use a long-lived signed URL instead
        const { data: signed, error: signErr } = await supabase.storage
          .from("team-photos")
          .createSignedUrl(path, 10 * 365 * 24 * 3600);
        if (signErr || !signed?.signedUrl) {
          Alert.alert(
            "Storage setup needed",
            `Go to Supabase Dashboard → Storage → team-photos → Make Public.\n\nURL check returned: ${urlCheck?.status ?? "network error"}`
          );
          return;
        }
        finalUrl = signed.signedUrl;
      }

      // Diagnostic: open this URL in a browser to verify the image is accessible
      Alert.alert(
        "Upload complete",
        `URL check: ${urlCheck?.status ?? "failed"}\n\nOpen in browser to verify:\n${urlData.publicUrl}`,
        [{ text: "OK" }]
      );

      const { error: dbError } = await supabase
        .from("teams")
        .update({ photo_url: finalUrl })
        .eq("id", teamId);
      if (dbError) throw dbError;

      setPhotoUrl(finalUrl);
    } catch (err: any) {
      Alert.alert("Upload failed", err.message ?? "Could not upload photo.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function saveSlots() {
    if (!teamId) return;
    setSavingSlots(true);
    await supabase.from("teams").update({ slot_pref_1: editSlot1, slot_pref_2: editSlot2 }).eq("id", teamId);
    setSlotPref1(editSlot1);
    setSlotPref2(editSlot2);
    setSavingSlots(false);
    setEditSlotsVisible(false);
  }

  async function postAnnouncement() {
    if (!user || !teamId || !newAnnouncement.trim()) return;
    setPostingAnnouncement(true);

    const mod = await moderateText(newAnnouncement.trim());
    if (!mod.ok) {
      Alert.alert("Post blocked", mod.message);
      setPostingAnnouncement(false);
      return;
    }

    const { data, error } = await supabase
      .from("team_announcements")
      .insert({ team_id: teamId, user_id: user.id, content: newAnnouncement.trim() })
      .select("id, created_at")
      .single();
    setPostingAnnouncement(false);
    if (error) { Alert.alert("Error", error.message); return; }
    setAnnouncements((prev) => [{
      id: data.id, user_id: user.id, username: "You", avatar_url: null,
      content: newAnnouncement.trim(), created_at: data.created_at,
    }, ...prev]);
    setNewAnnouncement("");
    setAnnounceVisible(false);
  }

  useEffect(() => { if (user) loadData(); }, [user, teamId]);

  // Build seasons as 8-week chunks from the date of the first score
  const seasons = useMemo<ComputedSeason[]>(() => {
    if (allScores.length === 0) return [];
    const firstMs = new Date(allScores[0].created_at).getTime();
    const lastMs = new Date(allScores[allScores.length - 1].created_at).getTime();
    const count = Math.ceil((lastMs - firstMs) / SEASON_MS) + 1;
    return Array.from({ length: count }, (_, i) => ({
      id: `s${i + 1}`,
      label: `Season ${i + 1}`,
      startMs: firstMs + i * SEASON_MS,
      endMs: firstMs + (i + 1) * SEASON_MS - 1,
    }));
  }, [allScores]);

  const filteredScores = useMemo(() => {
    if (selectedId === "all") return allScores;
    const s = seasons.find((s) => s.id === selectedId);
    if (!s) return allScores;
    return allScores.filter((sc) => {
      const ms = new Date(sc.created_at).getTime();
      return ms >= s.startMs && ms <= s.endMs;
    });
  }, [allScores, selectedId, seasons]);

  const playerStats = useMemo<PlayerStats[]>(() => {
    return members.map((m) => {
      const mine = filteredScores.filter((s) => s.user_id === m.user_id);
      if (mine.length === 0) return { ...m, games: 0, avg: 0, best: 0, bestWeekAvg: null, worstWeekAvg: null };
      const vals = mine.map((s) => s.score);
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      const avgs = weeklyAvgs(mine);
      return {
        ...m,
        games: mine.length,
        avg,
        best: Math.max(...vals),
        bestWeekAvg: avgs.length > 0 ? Math.max(...avgs) : null,
        worstWeekAvg: avgs.length > 0 ? Math.min(...avgs) : null,
      };
    }).sort((a, b) => b.avg - a.avg);
  }, [members, filteredScores]);

  const teamStats = useMemo(() => {
    if (filteredScores.length === 0) return null;
    const vals = filteredScores.map((s) => s.score);
    const teamAvg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    const avgs = weeklyAvgs(filteredScores);
    return {
      totalGames: filteredScores.length,
      teamAvg,
      bestWeek: avgs.length > 0 ? Math.max(...avgs) : 0,
      worstWeek: avgs.length > 0 ? Math.min(...avgs) : 0,
    };
  }, [filteredScores]);

  const isTeamMember = members.some((m) => m.user_id === user?.id);
  const isMonday = new Date().getDay() === 1;

  const seasonOptions = [{ id: "all", label: "All Time" }, ...seasons];
  const seasonLabel = seasonOptions.find((s) => s.id === selectedId)?.label ?? "Season";

  // Current season info for the pill subtitle
  const currentSeason = seasons.find((s) => s.id === selectedId);
  const seasonRange = currentSeason
    ? `${fmtDate(currentSeason.startMs)} – ${fmtDate(currentSeason.endMs)}`
    : null;

  if (loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

        {/* Top bar */}
        <View style={styles.topBar}>
          <Pressable style={styles.iconBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/teams" as any)}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {isTeamMember && (
              <Pressable style={styles.iconBtn} onPress={() => router.push({ pathname: "/team-chat" as any, params: { teamId, teamName } })}>
                <Ionicons name="chatbubbles-outline" size={20} color="#555" />
              </Pressable>
            )}
            {isCaptain && (
              <Pressable style={styles.iconBtn} onPress={() => router.push({ pathname: "/teams" as any })}>
                <Ionicons name="settings-outline" size={19} color="#555" />
              </Pressable>
            )}
          </View>
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <Pressable
            style={styles.teamIconWrap}
            onPress={isCaptain ? () => setPhotoSourceVisible(true) : undefined}
            disabled={uploadingPhoto}
          >
            {photoUrl ? (
              <Image source={{ uri: photoUrl }} style={styles.teamPhoto} contentFit="cover" cachePolicy="none" onError={(e) => console.log("[team-photo] image load error:", JSON.stringify(e))} />
            ) : (
              <Text style={styles.teamIconText}>{(teamName ?? "TM").slice(0, 2).toUpperCase()}</Text>
            )}
            {isCaptain && (
              <View style={styles.teamCameraChip}>
                {uploadingPhoto
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Ionicons name="camera" size={13} color="#000" />}
              </View>
            )}
          </Pressable>
          <Text style={styles.teamTitle}>{teamName}</Text>
          <Text style={styles.teamSub}>
            {members.length} {members.length === 1 ? "member" : "members"}
            {seasons.length > 0 ? `  ·  ${seasons.length} season${seasons.length !== 1 ? "s" : ""}` : ""}
          </Text>
          {isTeamMember && (isMonday || isAdmin) && (
            <Pressable
              style={styles.trackBtn}
              onPress={() => router.push({ pathname: "/skeeball-tracker" as any, params: { teamId, teamName } })}
            >
              <Ionicons name="bowling-ball-outline" size={16} color="#000" />
              <Text style={styles.trackBtnText}>Track Scores</Text>
            </Pressable>
          )}
          <View style={styles.slotPrefRow}>
            <Ionicons name="time-outline" size={14} color="#444" />
            <Text style={styles.slotPrefText}>
              {slotPref1 ? `${slotPref1}${slotPref2 ? ` · ${slotPref2}` : ""}` : "No time preference set"}
            </Text>
            {isCaptain && (
              <Pressable
                style={styles.slotEditBtn}
                onPress={() => { setEditSlot1(slotPref1); setEditSlot2(slotPref2); setEditSlotsVisible(true); }}
              >
                <Ionicons name="pencil" size={12} color="#06b6d4" />
              </Pressable>
            )}
          </View>
        </View>

        {/* Season picker pill */}
        <Pressable style={styles.seasonPill} onPress={() => setPickerVisible(true)}>
          <Ionicons name="layers-outline" size={14} color="#06b6d4" />
          <View>
            <Text style={styles.seasonPillLabel}>{seasonLabel}</Text>
            {seasonRange && <Text style={styles.seasonPillRange}>{seasonRange}</Text>}
          </View>
          <Ionicons name="chevron-down" size={13} color="#555" style={{ marginLeft: "auto" }} />
        </Pressable>

        {/* Team overview stats */}
        <SectionLabel text="Team Overview" />
        {teamStats ? (
          <View style={styles.statsGrid}>
            <StatCell label="Team Avg" value={teamStats.teamAvg} color="#06b6d4" />
            <StatCell label="Games Played" value={teamStats.totalGames} />
            <StatCell label="Best Week" value={teamStats.bestWeek} color="#22c55e" sub="avg" />
            <StatCell label="Worst Week" value={teamStats.worstWeek} color="#f87171" sub="avg" />
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="stats-chart-outline" size={32} color="#2a2a2a" />
            <Text style={styles.emptyCardText}>No scores recorded for {seasonLabel}.</Text>
          </View>
        )}

        {/* Announcements */}
        <View style={styles.announceSectionRow}>
          <Text style={styles.annSectionLabel}>Announcements</Text>
          {(isCaptain || isAdmin) && (
            <Pressable style={styles.announceAddBtn} onPress={() => setAnnounceVisible(true)}>
              <Ionicons name="add-circle" size={22} color="#06b6d4" />
            </Pressable>
          )}
        </View>
        {announcementsLoading ? (
          <ActivityIndicator size="small" color="#06b6d4" style={{ marginBottom: 20 }} />
        ) : announcements.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyCardText}>No announcements yet.</Text>
          </View>
        ) : (
          <View style={{ marginBottom: 28 }}>
            {announcements.map((ann) => (
              <View key={ann.id} style={styles.annCard}>
                <Avatar uri={ann.avatar_url} name={ann.username} size={36} radius={11} />
                <View style={{ flex: 1 }}>
                  <View style={styles.annCardHeader}>
                    <Text style={styles.annUsername}>{ann.username}</Text>
                    <Text style={styles.annTime}>{fmtRelTime(ann.created_at)}</Text>
                  </View>
                  <Text style={styles.annContent}>{ann.content}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Roster */}
        <SectionLabel text={`Roster · ${members.length}`} />
        {playerStats.map((p, i) => (
          <PlayerRow key={p.user_id} player={p} rank={i + 1} />
        ))}

        {members.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyCardText}>No members yet.</Text>
          </View>
        )}
      </ScrollView>

      {/* Team photo source picker */}
      <Modal visible={photoSourceVisible} transparent animationType="fade" onRequestClose={() => setPhotoSourceVisible(false)}>
        <View style={styles.photoPickerBg}>
          <Pressable style={styles.photoPickerDismiss} onPress={() => setPhotoSourceVisible(false)} />
          <View style={styles.photoPickerSheet}>
            <View style={styles.photoPickerHandle} />
            <Text style={styles.photoPickerTitle}>Team Photo</Text>
            <Pressable style={styles.photoPickerCamera} onPress={() => { setPhotoSourceVisible(false); pickTeamPhoto("camera"); }}>
              <Ionicons name="camera" size={22} color="#000" />
              <Text style={styles.photoPickerCameraText}>Take Photo</Text>
            </Pressable>
            <Pressable style={styles.photoPickerLibrary} onPress={() => { setPhotoSourceVisible(false); pickTeamPhoto("library"); }}>
              <Ionicons name="images-outline" size={22} color="#fff" />
              <Text style={styles.photoPickerLibraryText}>Choose from Library</Text>
            </Pressable>
            <Pressable style={styles.photoPickerCancel} onPress={() => setPhotoSourceVisible(false)}>
              <Text style={styles.photoPickerCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Season picker modal */}
      <Modal visible={pickerVisible} transparent animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <Pressable style={styles.modalBg} onPress={() => setPickerVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Select Season</Text>
            <Text style={styles.modalSub}>Each season is {SEASON_WEEKS} weeks</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 400 }}>
              {seasonOptions.map((s) => {
                const computed = seasons.find((cs) => cs.id === s.id);
                const active = selectedId === s.id;
                return (
                  <Pressable
                    key={s.id}
                    style={[styles.seasonRow, active && styles.seasonRowActive]}
                    onPress={() => { setSelectedId(s.id); setPickerVisible(false); }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.seasonRowLabel, active && styles.seasonRowLabelActive]}>{s.label}</Text>
                      {computed && (
                        <Text style={styles.seasonRowRange}>{fmtDate(computed.startMs)} – {fmtDate(computed.endMs)}</Text>
                      )}
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={20} color="#06b6d4" />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edit slot preferences modal */}
      <Modal visible={editSlotsVisible} transparent animationType="slide" onRequestClose={() => setEditSlotsVisible(false)}>
        <Pressable style={styles.modalBg} onPress={() => setEditSlotsVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Preferred Play Times</Text>
            <Text style={styles.modalSub}>Admin uses these when scheduling matches</Text>
            <Text style={styles.slotModalLabel}>1st Choice</Text>
            <View style={styles.slotModalRow}>
              {SLOTS.map((s) => (
                <Pressable
                  key={s}
                  style={[styles.slotChip, editSlot1 === s && styles.slotChipActive]}
                  onPress={() => { setEditSlot1(editSlot1 === s ? null : s); if (editSlot2 === s) setEditSlot2(null); }}
                >
                  <Text style={[styles.slotChipText, editSlot1 === s && styles.slotChipTextActive]}>{s}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.slotModalLabel}>2nd Choice (optional)</Text>
            <View style={styles.slotModalRow}>
              {SLOTS.filter((s) => s !== editSlot1).map((s) => (
                <Pressable
                  key={s}
                  style={[styles.slotChip, editSlot2 === s && styles.slotChipActive2]}
                  onPress={() => setEditSlot2(editSlot2 === s ? null : s)}
                >
                  <Text style={[styles.slotChipText, editSlot2 === s && styles.slotChipTextActive2]}>{s}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={[styles.slotSaveBtn, savingSlots && { opacity: 0.5 }]}
              onPress={saveSlots}
              disabled={savingSlots}
            >
              {savingSlots
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={styles.slotSaveBtnText}>Save Preferences</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Post announcement modal */}
      <Modal visible={announceVisible} transparent animationType="slide" onRequestClose={() => setAnnounceVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <Pressable style={styles.modalBg} onPress={() => setAnnounceVisible(false)}>
            <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>New Announcement</Text>
              <TextInput
                style={styles.annInput}
                placeholder="Write an announcement…"
                placeholderTextColor="#444"
                value={newAnnouncement}
                onChangeText={setNewAnnouncement}
                multiline
                maxLength={500}
              />
              <Pressable
                style={[styles.annPostBtn, (postingAnnouncement || !newAnnouncement.trim()) && { opacity: 0.4 }]}
                onPress={postAnnouncement}
                disabled={postingAnnouncement || !newAnnouncement.trim()}
              >
                {postingAnnouncement
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Text style={styles.annPostBtnText}>Post</Text>}
              </Pressable>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

function StatCell({ label, value, color = "#fff", sub }: {
  label: string; value: number; color?: string; sub?: string;
}) {
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statValue, { color }]}>{value.toLocaleString()}</Text>
      {sub && <Text style={styles.statSub}>{sub}</Text>}
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function PlayerRow({ player, rank }: { player: PlayerStats; rank: number }) {
  const hasScores = player.games > 0;
  return (
    <View style={styles.playerCard}>
      {/* Left: rank + avatar + name */}
      <View style={styles.playerLeft}>
        <Text style={styles.rankNum}>#{rank}</Text>
        <View style={[{ opacity: hasScores ? 1 : 0.4 }]}>
          <Avatar uri={player.avatar_url} name={player.username} size={44} radius={14} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.playerNameRow}>
            <Text style={styles.playerName} numberOfLines={1}>{player.username}</Text>
            {player.role === "captain" && (
              <View style={styles.capBadge}><Text style={styles.capBadgeText}>CAP</Text></View>
            )}
          </View>
          {hasScores ? (
            <Text style={styles.playerMeta}>{player.games} games · avg {player.avg}</Text>
          ) : (
            <Text style={styles.playerMetaDim}>No scores this period</Text>
          )}
        </View>
      </View>

      {/* Right: best / best week / worst week */}
      {hasScores && (
        <View style={styles.playerRight}>
          <Pip label="Best" value={player.best} />
          {player.bestWeekAvg !== null && <Pip label="↑ wk" value={player.bestWeekAvg} color="#22c55e" />}
          {player.worstWeekAvg !== null && <Pip label="↓ wk" value={player.worstWeekAvg} color="#f87171" />}
        </View>
      )}
    </View>
  );
}

function Pip({ label, value, color = "#fff" }: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.pip}>
      <Text style={[styles.pipVal, { color }]}>{value}</Text>
      <Text style={styles.pipLabel}>{label}</Text>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtRelTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  content: { paddingBottom: 48 },

  topBar: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingTop: 4, paddingBottom: 4,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },

  hero: { alignItems: "center", paddingTop: 8, paddingBottom: 28, paddingHorizontal: 20 },
  teamIconWrap: {
    width: 76, height: 76, borderRadius: 22,
    backgroundColor: "rgba(6,182,212,0.1)", borderWidth: 1.5, borderColor: "rgba(6,182,212,0.3)",
    alignItems: "center", justifyContent: "center", marginBottom: 14,
    overflow: "hidden",
  },
  teamPhoto: { width: 76, height: 76 },
  teamIconText: { color: "#06b6d4", fontSize: 26, fontWeight: "900" },
  teamCameraChip: {
    position: "absolute", bottom: 4, right: 4,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#000",
  },
  teamTitle: { color: "#fff", fontSize: 28, fontWeight: "900", letterSpacing: -0.4, marginBottom: 5 },
  teamSub: { color: "#555", fontSize: 13 },
  trackBtn: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "#06b6d4", borderRadius: 20,
    paddingHorizontal: 20, paddingVertical: 10, marginTop: 16,
  },
  trackBtnText: { color: "#000", fontWeight: "900", fontSize: 14 },

  seasonPill: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#111", borderRadius: 18,
    paddingHorizontal: 18, paddingVertical: 12,
    borderWidth: 1, borderColor: "#1e1e1e",
    marginHorizontal: 20, marginBottom: 32,
  },
  seasonPillLabel: { color: "#fff", fontSize: 14, fontWeight: "800" },
  seasonPillRange: { color: "#444", fontSize: 11, marginTop: 1 },

  sectionLabel: {
    color: "#444", fontSize: 11, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1.2,
    marginBottom: 12, paddingHorizontal: 20,
  },

  statsGrid: {
    flexDirection: "row", flexWrap: "wrap",
    paddingHorizontal: 16, gap: 10, marginBottom: 32,
  },
  statCell: {
    flex: 1, minWidth: "45%",
    backgroundColor: "#111", borderRadius: 20,
    padding: 20, alignItems: "center",
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  statValue: { fontSize: 32, fontWeight: "900", letterSpacing: -0.5 },
  statSub: { color: "#444", fontSize: 11, fontWeight: "600", marginTop: -2 },
  statLabel: { color: "#555", fontSize: 12, fontWeight: "600", marginTop: 4 },

  emptyCard: {
    backgroundColor: "#0d0d0d", borderRadius: 18,
    padding: 32, alignItems: "center", gap: 10,
    marginHorizontal: 20, marginBottom: 28,
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  emptyCardText: { color: "#444", fontSize: 14, textAlign: "center" },

  playerCard: {
    backgroundColor: "#111", borderRadius: 18, padding: 16,
    flexDirection: "row", alignItems: "center",
    marginHorizontal: 20, marginBottom: 10,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  playerLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  rankNum: { color: "#2a2a2a", fontSize: 12, fontWeight: "900", width: 22, textAlign: "center" },
  playerAvatar: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: "#1c1c1c", alignItems: "center", justifyContent: "center",
  },
  playerAvatarText: { color: "#fff", fontWeight: "800", fontSize: 17 },
  playerNameRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 2 },
  playerName: { color: "#fff", fontSize: 15, fontWeight: "800", flexShrink: 1 },
  capBadge: {
    backgroundColor: "rgba(245,158,11,0.14)", borderRadius: 5,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  capBadgeText: { color: "#f59e0b", fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  playerMeta: { color: "#555", fontSize: 12 },
  playerMetaDim: { color: "#333", fontSize: 12, fontStyle: "italic" },

  playerRight: { flexDirection: "row", gap: 16, paddingLeft: 8 },
  pip: { alignItems: "center" },
  pipVal: { fontSize: 15, fontWeight: "900" },
  pipLabel: { color: "#333", fontSize: 10, fontWeight: "700", marginTop: 1 },

  // Modal
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40,
    borderTopWidth: 1, borderColor: "#1e1e1e",
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 20 },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  modalSub: { color: "#555", fontSize: 13, marginBottom: 20 },
  seasonRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  seasonRowActive: {},
  seasonRowLabel: { color: "#777", fontSize: 16, fontWeight: "700" },
  seasonRowLabelActive: { color: "#fff" },
  seasonRowRange: { color: "#333", fontSize: 12, marginTop: 2 },

  photoPickerBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  photoPickerDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  photoPickerSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36,
    borderTopWidth: 1, borderColor: "#1e1e1e", gap: 10,
  },
  photoPickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 12 },
  photoPickerTitle: { color: "#fff", fontSize: 16, fontWeight: "900", textAlign: "center", marginBottom: 4 },
  photoPickerCamera: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#06b6d4", borderRadius: 16, padding: 16,
  },
  photoPickerCameraText: { color: "#000", fontWeight: "900", fontSize: 16 },
  photoPickerLibrary: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#1a1a1a", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "#2a2a2a",
  },
  photoPickerLibraryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  photoPickerCancel: { backgroundColor: "#0d0d0d", borderRadius: 16, padding: 16, alignItems: "center", marginTop: 4 },
  photoPickerCancelText: { color: "#555", fontWeight: "700", fontSize: 15 },

  // Slot preferences
  slotPrefRow: {
    flexDirection: "row", alignItems: "center", gap: 7, marginTop: 14,
    backgroundColor: "#0d0d0d", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  slotPrefText: { color: "#555", fontSize: 13, fontWeight: "600", flex: 1 },
  slotEditBtn: {
    width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(6,182,212,0.1)",
    alignItems: "center", justifyContent: "center",
  },

  // Slot modal
  slotModalLabel: { color: "#555", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, marginTop: 6 },
  slotModalRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  slotChip: {
    flex: 1, paddingVertical: 11, borderRadius: 12,
    backgroundColor: "#1a1a1a", alignItems: "center",
    borderWidth: 1, borderColor: "#2a2a2a",
  },
  slotChipActive: { backgroundColor: "rgba(6,182,212,0.15)", borderColor: "#06b6d4" },
  slotChipActive2: { backgroundColor: "rgba(99,102,241,0.15)", borderColor: "#6366f1" },
  slotChipText: { color: "#555", fontSize: 13, fontWeight: "700" },
  slotChipTextActive: { color: "#06b6d4" },
  slotChipTextActive2: { color: "#6366f1" },
  slotSaveBtn: {
    backgroundColor: "#06b6d4", borderRadius: 16, paddingVertical: 15,
    alignItems: "center", marginTop: 8,
  },
  slotSaveBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },

  // Announcements section
  announceSectionRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, marginBottom: 12,
  },
  annSectionLabel: {
    color: "#444", fontSize: 11, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1.2,
  },
  announceAddBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  annCard: {
    flexDirection: "row", gap: 12, alignItems: "flex-start",
    backgroundColor: "#111", borderRadius: 16, padding: 14,
    marginHorizontal: 20, marginBottom: 8,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  annCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  annUsername: { color: "#fff", fontSize: 13, fontWeight: "800" },
  annTime: { color: "#333", fontSize: 11 },
  annContent: { color: "#aaa", fontSize: 14, lineHeight: 20 },

  // Announcement input
  annInput: {
    backgroundColor: "#1a1a1a", borderRadius: 14, padding: 16,
    color: "#fff", fontSize: 15, lineHeight: 22,
    minHeight: 100, textAlignVertical: "top",
    borderWidth: 1, borderColor: "#2a2a2a", marginBottom: 16,
  },
  annPostBtn: {
    backgroundColor: "#06b6d4", borderRadius: 16, paddingVertical: 15,
    alignItems: "center",
  },
  annPostBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
});
