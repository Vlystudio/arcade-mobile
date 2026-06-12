import { pickFromCamera, pickFromLibrary } from "../../lib/pick-image";
import { Image } from "expo-image";
import { Avatar } from "../components/avatar";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
} from "react-native";
import { Alert } from "../../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { openUserProfile } from "../lib/open-profile";
import { moderateText } from "../../lib/moderate-text";
import { uploadModeratedPublicImage } from "../../lib/moderated-public-media";
import { useRequireAuth } from "../hooks/use-require-auth";
import { validateChatMessage, validateTeamName } from "../../lib/validation";
import { InsightChips, LaneStats, RingBreakdown, TrendBadge, WeeklyBarChart } from "../components/skeeball-stats";
import {
  fetchHeadToHead,
  fetchPlayerInsights,
  fetchPlayerStats,
  fetchPositionStats,
  fetchSkeeSeasons,
  fetchStandings,
  fetchTeamStats,
  fetchTeamWeekHistory,
  suggestOrder,
  weekLabel,
  type HeadToHead,
  type OrderSuggestion,
  type PlayerInsights,
  type PlayerPositionStats,
  type PlayerStats as LeaguePlayerStats,
  type SkeeSeason,
  type TeamStats as LeagueTeamStats,
  type TeamWeekHistory,
} from "../lib/skeeball-stats";
import { API_BASE } from "../../lib/api-base";
import { showToast } from "../components/toast";

type CoachResult = {
  order: { username: string; position: number; reason: string }[];
  tips: string[];
  confidence: "high" | "medium" | "low";
};

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

function currentMondayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

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

type BannedUser = { user_id: string; username: string; banned_at: string };

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
    if (!map[k]) map[k] = []; map[k].push(s.score);
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
  const [bannedFromTeam, setBannedFromTeam] = useState(false);
  const [bannedUsers, setBannedUsers] = useState<BannedUser[]>([]);
  const [kickingId, setKickingId] = useState<string | null>(null);
  const [banningId, setBanningId] = useState<string | null>(null);
  const [memberActionTarget, setMemberActionTarget] = useState<{ userId: string; username: string } | null>(null);

  // Slot preferences
  const [slotPref1, setSlotPref1] = useState<string | null>(null);
  const [slotPref2, setSlotPref2] = useState<string | null>(null);
  const [editSlotsVisible, setEditSlotsVisible] = useState(false);
  const [editSlot1, setEditSlot1] = useState<string | null>(null);
  const [editSlot2, setEditSlot2] = useState<string | null>(null);
  const [savingSlots, setSavingSlots] = useState(false);

  // Skee-ball league performance
  const [skeeSeasons, setSkeeSeasons] = useState<SkeeSeason[]>([]);
  const [selectedSkeeSeasonId, setSelectedSkeeSeasonId] = useState<string | "all">("all");
  const [skeePickerVisible, setSkeePickerVisible] = useState(false);
  const [leagueTeam, setLeagueTeam] = useState<LeagueTeamStats | null>(null);
  const [leagueRank, setLeagueRank] = useState<number | null>(null);
  const [activeSession, setActiveSession] = useState<{ id: string; lane_number: number } | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [leagueLoading, setLeagueLoading] = useState(false);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [expandedMemberStats, setExpandedMemberStats] = useState<LeaguePlayerStats | null>(null);

  // Lineup optimizer + AI coach
  const [positionStats, setPositionStats] = useState<PlayerPositionStats[]>([]);
  const [weekHistory, setWeekHistory] = useState<TeamWeekHistory | null>(null);
  const [coachOpponent, setCoachOpponent] = useState<{ id: string; name: string } | null>(null);
  const [opponentPickerVisible, setOpponentPickerVisible] = useState(false);
  const [opponentOptions, setOpponentOptions] = useState<{ id: string; name: string }[]>([]);
  const [coachResult, setCoachResult] = useState<CoachResult | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [headToHead, setHeadToHead] = useState<HeadToHead | null>(null);
  const [expandedMemberInsights, setExpandedMemberInsights] = useState<PlayerInsights | null>(null);
  const [recapResult, setRecapResult] = useState<{ recap: string; highlights: string[]; mode: string } | null>(null);
  const [recapLoading, setRecapLoading] = useState<"week" | "season" | null>(null);
  const [recapError, setRecapError] = useState<string | null>(null);

  // League night RSVP + subs + disputes
  const [rsvps, setRsvps] = useState<Record<string, "in" | "out">>({});
  const [savingRsvp, setSavingRsvp] = useState(false);
  const [openSubRequest, setOpenSubRequest] = useState<{ id: string; status: string } | null>(null);
  const [requestingSub, setRequestingSub] = useState(false);
  const [disputeVisible, setDisputeVisible] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeSessionId, setDisputeSessionId] = useState<string | null>(null);
  const [raisingDispute, setRaisingDispute] = useState(false);

  // Captain tools: invites + join requests (under the gear menu)
  const [inviteVisible, setInviteVisible] = useState(false);
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteResults, setInviteResults] = useState<{ id: string; username: string }[]>([]);
  const [inviteSearching, setInviteSearching] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteSentTo, setInviteSentTo] = useState<string | null>(null);
  const [requestsVisible, setRequestsVisible] = useState(false);
  const [joinRequests, setJoinRequests] = useState<{ id: string; user_id: string; username: string; message: string | null }[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [pendingReqCount, setPendingReqCount] = useState(0);

  // Team settings (captain gear menu)
  const [teamSettingsVisible, setTeamSettingsVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameText, setRenameText] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);

  // Announcements
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [newAnnouncement, setNewAnnouncement] = useState("");
  const [postingAnnouncement, setPostingAnnouncement] = useState(false);
  const [announceVisible, setAnnounceVisible] = useState(false);

  async function loadData() {
    if (!teamId || !user) return;

    // Gate: check if current user is banned from this team
    const { data: banCheck } = await supabase
      .from("team_bans")
      .select("id")
      .eq("team_id", teamId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (banCheck) {
      setBannedFromTeam(true);
      setLoading(false);
      return;
    }

    const [membersRes, teamRes, profileRes, bannedRes] = await Promise.all([
      supabase.from("team_members").select("user_id, role, profiles(username, avatar_url)").eq("team_id", teamId),
      supabase.from("teams").select("captain_user_id, photo_url, slot_pref_1, slot_pref_2").eq("id", teamId).single(),
      supabase.from("profiles").select("role").eq("id", user.id).single(),
      supabase.from("team_bans").select("user_id, created_at").eq("team_id", teamId),
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

    // Load banned users list (RLS: only visible to the captain via banned_by = auth.uid())
    const bannedUserIds = (bannedRes.data ?? []).map((b: any) => b.user_id as string);
    if (bannedUserIds.length > 0) {
      const { data: bannedProfiles } = await supabase
        .from("profiles").select("id, username").in("id", bannedUserIds);
      const profileMap: Record<string, string> = {};
      for (const p of bannedProfiles ?? []) profileMap[(p as any).id] = (p as any).username ?? "Unknown";
      setBannedUsers((bannedRes.data ?? []).map((b: any) => ({
        user_id: b.user_id,
        username: profileMap[b.user_id] ?? "Unknown",
        banned_at: b.created_at,
      })));
    } else {
      setBannedUsers([]);
    }

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
      const { data: ap } = await supabase.from("public_profiles").select("id, username, avatar_url").in("id", annUserIds);
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

    // MIME type allowlist — reject non-image files
    const mimeType = asset.mimeType ?? "image/jpeg";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      Alert.alert("Unsupported file type", "Please choose a JPEG, PNG, or WebP image.");
      return;
    }

    setUploadingPhoto(true);
    try {
      const ext = mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";

      // Read via FileReader → ArrayBuffer (more reliable than blob in React Native)
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      if (!blob || blob.size === 0) throw new Error("Image file appears empty — try a different photo");

      // 5 MB size limit
      if (blob.size > 5 * 1024 * 1024) {
        throw new Error("Photo is too large (max 5 MB). Please choose a smaller image.");
      }

      const arrayBuffer: ArrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(new Error("Failed to read image data"));
        reader.readAsArrayBuffer(blob);
      });

      const path = `${teamId}/photo.${ext}`;
      let finalUrl = (await uploadModeratedPublicImage({
        ownerId: user.id,
        data: arrayBuffer,
        contentType: mimeType,
        publicBucket: "team-photos",
        publicPath: path,
        recordType: "team_photo",
        recordId: teamId,
      })).publicUrl;


        // Bucket is private — use a long-lived signed URL instead
      // Content moderation — runs before the DB update so flagged photos are never saved
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
    const announcement = validateChatMessage(newAnnouncement);
    if (!user || !teamId || !announcement.ok) return;
    setPostingAnnouncement(true);

    const mod = await moderateText(announcement.value);
    if (!mod.ok) {
      Alert.alert("Post blocked", mod.message);
      setPostingAnnouncement(false);
      return;
    }

    const { data, error } = await supabase
      .from("team_announcements")
      .insert({ team_id: teamId, user_id: user.id, content: announcement.value })
      .select("id, created_at")
      .single();
    setPostingAnnouncement(false);
    if (error) { Alert.alert("Error", error.message); return; }
    setAnnouncements((prev) => [{
      id: data.id, user_id: user.id, username: "You", avatar_url: null,
      content: announcement.value, created_at: data.created_at,
    }, ...prev]);
    setNewAnnouncement("");
    setAnnounceVisible(false);
  }

  async function handleKick(memberId: string) {
    setKickingId(memberId);
    const { data } = await supabase.rpc("rpc_team_kick", { p_team_id: teamId, p_member_id: memberId });
    setKickingId(null);
    if ((data as any)?.error) {
      Alert.alert("Error", (data as any).error);
    } else {
      loadData();
    }
  }

  async function handleBan(memberId: string) {
    setBanningId(memberId);
    const { data } = await supabase.rpc("rpc_team_ban", { p_team_id: teamId, p_member_id: memberId });
    setBanningId(null);
    if ((data as any)?.error) {
      Alert.alert("Error", (data as any).error);
    } else {
      loadData();
    }
  }

  async function handleUnban(userId: string, username: string) {
    Alert.alert(
      `Unban ${username}?`,
      "They'll be able to search and request to join this team again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unban",
          onPress: async () => {
            const { data } = await supabase.rpc("rpc_team_unban", { p_team_id: teamId, p_member_id: userId });
            if ((data as any)?.error) {
              Alert.alert("Error", (data as any).error);
            } else {
              setBannedUsers((prev) => prev.filter((b) => b.user_id !== userId));
            }
          },
        },
      ]
    );
  }

  useEffect(() => { if (user) loadData(); }, [user, teamId]);

  // League seasons: default to the active one
  useEffect(() => {
    if (!user) return;
    fetchSkeeSeasons().then((all) => {
      setSkeeSeasons(all);
      const active = all.find((s) => s.status === "active");
      if (active) setSelectedSkeeSeasonId(active.id);
    });
  }, [user]);

  async function handleLaneCheckout() {
    if (!activeSession || checkingOut) return;
    setCheckingOut(true);
    const { data, error } = await supabase.rpc("rpc_skeeball_cancel_session", {
      p_session_id: activeSession.id,
    });
    setCheckingOut(false);
    if (error || data?.error) {
      showToast(data?.message ?? "Couldn't check out of the lane.", "error");
      if (data?.error === "not_found") setActiveSession(null);
      return;
    }
    showToast(`Checked out of Lane ${data.lane_number} — it's free again`);
    setActiveSession(null);
  }

  const selectedSkeeSeason = skeeSeasons.find((s) => s.id === selectedSkeeSeasonId) ?? null;

  // Load team league stats whenever the season selection changes
  useEffect(() => {
    if (!user || !teamId) return;
    setLeagueLoading(true);
    setExpandedMemberId(null);
    setExpandedMemberStats(null);
    setCoachResult(null);
    Promise.all([
      fetchTeamStats(teamId, selectedSkeeSeason),
      fetchPositionStats(teamId, selectedSkeeSeason),
      fetchTeamWeekHistory(teamId, selectedSkeeSeason),
      fetchStandings(selectedSkeeSeason).then((rows) => {
        const idx = rows.findIndex((r) => r.team_id === teamId);
        setLeagueRank(idx >= 0 ? idx + 1 : null);
      }),
      supabase.from("skeeball_sessions")
        .select("id, lane_number")
        .eq("team_id", teamId).eq("status", "active")
        .maybeSingle()
        .then(({ data }) => setActiveSession(data ? { id: (data as any).id, lane_number: (data as any).lane_number } : null)),
    ]).then(([stats, posStats, history]) => {
      setLeagueTeam(stats);
      setPositionStats(posStats);
      setWeekHistory(history);
      setLeagueLoading(false);
      loadNightOps(history?.upcoming?.week_of ?? currentMondayStr());
      loadPendingReqCount();
    });
  }, [user, teamId, selectedSkeeSeasonId, skeeSeasons.length]);

  async function openOpponentPicker() {
    if (opponentOptions.length === 0) {
      const { data } = await supabase.from("teams").select("id, name").neq("id", teamId).order("name");
      setOpponentOptions((data ?? []).map((t: any) => ({ id: t.id, name: t.name })));
    }
    setOpponentPickerVisible(true);
  }

  async function askCoach() {
    if (!teamId || coachLoading) return;
    setCoachLoading(true);
    setCoachError(null);
    setCoachResult(null);
    try {
      const resp = await fetch(`${API_BASE}/api/skeeball/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "coach",
          teamId,
          opponentTeamId: coachOpponent?.id ?? undefined,
          seasonStart: selectedSkeeSeason?.start_week ?? undefined,
          seasonEnd: selectedSkeeSeason?.end_week ?? undefined,
        }),
      });
      const json = await resp.json();
      if (!resp.ok || json.error) {
        setCoachError(json.error ?? "Coach analysis failed. Please try again.");
      } else if (json.ok === false) {
        setCoachError(json.message ?? "Not enough data yet.");
      } else {
        setCoachResult({ order: json.order ?? [], tips: json.tips ?? [], confidence: json.confidence ?? "low" });
      }
    } catch {
      setCoachError("Network error. Please try again.");
    } finally {
      setCoachLoading(false);
    }
  }

  async function loadPendingReqCount() {
    if (!teamId) return;
    const { count } = await supabase
      .from("team_requests")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId)
      .eq("status", "pending");
    setPendingReqCount(count ?? 0);
  }

  async function searchInviteUsers(text: string) {
    setInviteSearch(text);
    if (!text.trim() || !user) { setInviteResults([]); return; }
    setInviteSearching(true);
    const { data } = await supabase
      .from("public_profiles")
      .select("id, username")
      .ilike("username", `%${text.trim()}%`)
      .neq("id", user.id)
      .limit(8);
    setInviteResults((data ?? []).map((r: any) => ({ id: r.id, username: r.username ?? "Unknown" })));
    setInviteSearching(false);
  }

  async function handleInviteUser(inviteeId: string, username: string) {
    if (!teamId || inviting) return;
    setInviting(true);
    const { error } = await supabase.from("team_requests").upsert(
      { team_id: teamId, user_id: inviteeId, direction: "invite", status: "pending", message: null },
      { onConflict: "team_id,user_id" },
    );
    setInviting(false);
    if (error) { Alert.alert("Error", error.message); return; }
    setInviteSentTo(username);
    setInviteSearch("");
    setInviteResults([]);
  }

  async function loadJoinRequests() {
    if (!teamId) return;
    setRequestsLoading(true);
    const { data: reqData } = await supabase
      .from("team_requests")
      .select("id, user_id, message")
      .eq("team_id", teamId)
      .eq("status", "pending")
      .eq("direction", "request");
    const userIds = (reqData ?? []).map((r: any) => r.user_id);
    let nameMap: Record<string, string> = {};
    if (userIds.length) {
      const { data: profs } = await supabase.from("public_profiles").select("id, username").in("id", userIds);
      for (const pr of profs ?? []) nameMap[(pr as any).id] = (pr as any).username ?? "Unknown";
    }
    setJoinRequests((reqData ?? []).map((r: any) => ({
      id: r.id, user_id: r.user_id, username: nameMap[r.user_id] ?? "Unknown", message: r.message ?? null,
    })));
    setRequestsLoading(false);
  }

  async function approveJoinRequest(requestId: string, userId: string) {
    if (!teamId) return;
    const { error: updErr } = await supabase.from("team_requests").update({ status: "approved" }).eq("id", requestId);
    if (updErr) { Alert.alert("Error", updErr.message); return; }
    const { error: insErr } = await supabase.from("team_members").insert({ team_id: teamId, user_id: userId, role: "member" });
    if (insErr) { Alert.alert("Error", insErr.message); return; }
    setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
    setPendingReqCount((n) => Math.max(n - 1, 0));
    showToast("Player added to the team");
    loadData();
  }

  async function denyJoinRequest(requestId: string) {
    await supabase.from("team_requests").update({ status: "denied" }).eq("id", requestId);
    setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
    setPendingReqCount((n) => Math.max(n - 1, 0));
  }

  async function loadNightOps(weekOf: string) {
    if (!teamId) return;
    const [rsvpRes, subRes] = await Promise.all([
      supabase.from("league_rsvps").select("user_id, status").eq("team_id", teamId).eq("week_of", weekOf),
      supabase.from("sub_requests").select("id, status").eq("team_id", teamId).eq("week_of", weekOf).in("status", ["open", "filled"]).maybeSingle(),
    ]);
    const map: Record<string, "in" | "out"> = {};
    for (const r of rsvpRes.data ?? []) map[(r as any).user_id] = (r as any).status;
    setRsvps(map);
    setOpenSubRequest(subRes.data ? { id: (subRes.data as any).id, status: (subRes.data as any).status } : null);
  }

  async function setMyRsvp(weekOf: string, status: "in" | "out") {
    if (!user || !teamId || savingRsvp) return;
    setSavingRsvp(true);
    await supabase.from("league_rsvps").upsert(
      { user_id: user.id, team_id: teamId, week_of: weekOf, status, updated_at: new Date().toISOString() },
      { onConflict: "user_id,week_of" },
    );
    setRsvps((prev) => ({ ...prev, [user.id]: status }));
    setSavingRsvp(false);
    showToast(status === "in" ? "You're in for league night" : "Marked out — consider requesting a sub", "info");
  }

  async function requestSub(weekOf: string) {
    if (!teamId || requestingSub) return;
    setRequestingSub(true);
    const { data, error } = await supabase.rpc("rpc_request_sub", {
      p_team_id: teamId, p_week_of: weekOf, p_note: null,
    });
    setRequestingSub(false);
    if (error || (data as any)?.error) {
      Alert.alert("Couldn't request sub", (data as any)?.message ?? error?.message ?? "Try again.");
      return;
    }
    setOpenSubRequest({ id: (data as any).id, status: "open" });
    showToast("Sub request posted — available subs have been notified");
    notifyLeague("sub_request", { teamId, weekOf });
  }

  async function notifyLeague(action: string, extra: Record<string, unknown>) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      await fetch(`${API_BASE}/api/push/league`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action, ...extra }),
      });
    } catch {}
  }

  async function raiseDispute() {
    if (!disputeSessionId || raisingDispute) return;
    setRaisingDispute(true);
    const { data, error } = await supabase.rpc("rpc_raise_score_dispute", {
      p_session_id: disputeSessionId, p_reason: disputeReason.trim(),
    });
    setRaisingDispute(false);
    if (error || (data as any)?.error) {
      Alert.alert("Couldn't submit dispute", (data as any)?.message ?? error?.message ?? "Try again.");
      return;
    }
    setDisputeVisible(false);
    setDisputeReason("");
    setDisputeSessionId(null);
    showToast("Dispute sent to the admins with your game's ball record");
  }

  async function toggleMemberExpand(userId: string) {
    if (expandedMemberId === userId) {
      setExpandedMemberId(null);
      setExpandedMemberStats(null);
      setExpandedMemberInsights(null);
      return;
    }
    setExpandedMemberId(userId);
    setExpandedMemberStats(null);
    setExpandedMemberInsights(null);
    const [stats, insights] = await Promise.all([
      fetchPlayerStats(userId, selectedSkeeSeason),
      fetchPlayerInsights(userId, selectedSkeeSeason),
    ]);
    setExpandedMemberStats(stats);
    setExpandedMemberInsights(insights);
  }

  // Head-to-head record loads when an opponent is picked for the coach
  useEffect(() => {
    if (!teamId || !coachOpponent) { setHeadToHead(null); return; }
    fetchHeadToHead(teamId, coachOpponent.id, selectedSkeeSeason).then(setHeadToHead);
  }, [teamId, coachOpponent?.id, selectedSkeeSeasonId]);

  async function handleRenameTeam() {
    const name = validateTeamName(renameText);
    if (!teamId || !name.ok || renaming) return;
    setRenaming(true);
    const { error } = await supabase.from("teams").update({ name: name.value }).eq("id", teamId);
    setRenaming(false);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    setDisplayName(name.value);
    setRenameVisible(false);
    showToast("Team renamed");
  }

  async function askRecap(mode: "week" | "season") {
    if (!teamId || recapLoading) return;
    setRecapLoading(mode);
    setRecapError(null);
    setRecapResult(null);
    try {
      const resp = await fetch(`${API_BASE}/api/skeeball/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "recap",
          teamId,
          mode,
          seasonStart: selectedSkeeSeason?.start_week ?? undefined,
          seasonEnd: selectedSkeeSeason?.end_week ?? undefined,
        }),
      });
      const json = await resp.json();
      if (!resp.ok || json.error) setRecapError(json.error ?? "Recap failed. Please try again.");
      else if (json.ok === false) setRecapError(json.message ?? "No games to recap yet.");
      else setRecapResult({ recap: json.recap, highlights: json.highlights ?? [], mode });
    } catch {
      setRecapError("Network error. Please try again.");
    } finally {
      setRecapLoading(null);
    }
  }

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

  if (bannedFromTeam) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.bannedGate}>
          <Ionicons name="ban" size={56} color="#ef4444" style={{ marginBottom: 20 }} />
          <Text style={styles.bannedGateTitle}>Access Restricted</Text>
          <Text style={styles.bannedGateSub}>You've been banned from this team and cannot view its content.</Text>
          <Pressable
            style={styles.bannedGateBtn}
            onPress={() => router.canGoBack() ? router.back() : router.replace("/teams" as any)}
          >
            <Text style={styles.bannedGateBtnText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
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
              <Pressable style={styles.iconBtn} onPress={() => setTeamSettingsVisible(true)}>
                <Ionicons name="settings-outline" size={19} color="#555" />
                {pendingReqCount > 0 && <View style={styles.gearDot} />}
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
          <Text style={styles.teamTitle}>{displayName ?? teamName}</Text>
          <Text style={styles.teamSub}>
            {members.length} {members.length === 1 ? "member" : "members"}
            {seasons.length > 0 ? `  ·  ${seasons.length} season${seasons.length !== 1 ? "s" : ""}` : ""}
          </Text>
          {leagueTeam && leagueTeam.weeks.length > 0 && (
            <View style={styles.heroStatsRow}>
              <View style={styles.heroStat}>
                <Text style={styles.heroStatValue}>{leagueRank ? `#${leagueRank}` : "—"}</Text>
                <Text style={styles.heroStatLabel}>Rank</Text>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStat}>
                <Text style={[styles.heroStatValue, { color: "#f59e0b" }]}>{leagueTeam.season_points}</Text>
                <Text style={styles.heroStatLabel}>Points</Text>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStat}>
                <Text style={styles.heroStatValue}>
                  {"🥇"} {leagueTeam.weeks.filter((w) => w.best_placement === 1).length}
                </Text>
                <Text style={styles.heroStatLabel}>Wins</Text>
              </View>
            </View>
          )}
          {isTeamMember && (
            <View style={styles.trackActions}>
              <Pressable
                style={styles.trackBtn}
                onPress={() => router.push({ pathname: "/scan-lane" as any, params: { mode: "skeeball", teamId, teamName } })}
              >
                <Ionicons name="qr-code-outline" size={16} color="#000" />
                <Text style={styles.trackBtnText}>Scan Lane QR</Text>
              </Pressable>
              {(isMonday || isAdmin) && (
                <Pressable
                  style={[styles.trackBtn, styles.trackManualBtn]}
                  onPress={() => router.push({ pathname: "/skeeball-tracker" as any, params: { teamId, teamName } })}
                >
                  <Ionicons name="bowling-ball-outline" size={16} color="#06b6d4" />
                  <Text style={styles.trackManualBtnText}>Manual Entry</Text>
                </Pressable>
              )}
            </View>
          )}
          {isTeamMember && activeSession && (
            <View style={styles.activeLaneBanner}>
              <Ionicons name="locate" size={14} color="#22c55e" />
              <Text style={styles.activeLaneText}>Checked in — Lane {activeSession.lane_number}</Text>
              <Pressable
                style={[styles.checkoutBtn, checkingOut && { opacity: 0.5 }]}
                onPress={handleLaneCheckout}
                disabled={checkingOut}
              >
                {checkingOut
                  ? <ActivityIndicator size="small" color="#ef4444" />
                  : <Text style={styles.checkoutBtnText}>Check out</Text>}
              </Pressable>
            </View>
          )}

          <View style={styles.slotPrefRow}>
            <Ionicons name="time-outline" size={14} color="#444" />
            <Text style={styles.slotPrefText}>
              {slotPref1 ? `Preferred: ${slotPref1}${slotPref2 ? ` · ${slotPref2}` : ""}` : "No time preference set"}
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

        {/* ── Skee-Ball League Performance ── */}
        <View style={styles.leagueHeaderRow}>
          <SectionLabel text="League Performance" />
          <Pressable style={styles.leagueSeasonPill} onPress={() => setSkeePickerVisible(true)}>
            <Ionicons name="trophy-outline" size={12} color="#f59e0b" />
            <Text style={styles.leagueSeasonPillText}>
              {selectedSkeeSeason ? selectedSkeeSeason.name : "All Time"}
            </Text>
            <Ionicons name="chevron-down" size={12} color="#555" />
          </Pressable>
        </View>

        {leagueLoading ? (
          <ActivityIndicator color="#06b6d4" style={{ marginVertical: 24 }} />
        ) : !leagueTeam || leagueTeam.weeks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="bowling-ball-outline" size={32} color="#2a2a2a" />
            <Text style={styles.emptyCardText}>
              No league games {selectedSkeeSeason ? `in ${selectedSkeeSeason.name}` : "yet"}.
            </Text>
          </View>
        ) : (
          <View style={styles.leagueCard}>
            {/* Summary */}
            <View style={styles.leagueSummaryRow}>
              <View style={styles.leagueSummaryBox}>
                <Text style={[styles.leagueSummaryValue, { color: "#f59e0b" }]}>{leagueTeam.season_points}</Text>
                <Text style={styles.leagueSummaryLabel}>League Pts</Text>
              </View>
              <View style={styles.leagueSummaryBox}>
                <Text style={styles.leagueSummaryValue}>
                  {Math.round(leagueTeam.weeks.reduce((a, w) => a + w.avg, 0) / leagueTeam.weeks.length)}
                </Text>
                <Text style={styles.leagueSummaryLabel}>Avg Game</Text>
              </View>
              <View style={styles.leagueSummaryBox}>
                <Text style={[styles.leagueSummaryValue, { color: "#22c55e" }]}>
                  {Math.max(...leagueTeam.weeks.map((w) => w.best))}
                </Text>
                <Text style={styles.leagueSummaryLabel}>Best Game</Text>
              </View>
              <View style={styles.leagueSummaryBox}>
                <Text style={[styles.leagueSummaryValue, { color: "#a855f7" }]}>
                  {leagueTeam.weeks.reduce((a, w) => a + w.games, 0)}
                </Text>
                <Text style={styles.leagueSummaryLabel}>Games</Text>
              </View>
            </View>

            {/* Weekly chart + trend */}
            <View style={styles.leagueChartHeader}>
              <Text style={styles.leagueSubLabel}>Team Weekly Average</Text>
              <TrendBadge weeks={leagueTeam.weeks} />
            </View>
            <WeeklyBarChart weeks={leagueTeam.weeks} season={selectedSkeeSeason} />

            {/* Member performance */}
            <Text style={[styles.leagueSubLabel, { marginTop: 14 }]}>Player Performance</Text>
            {leagueTeam.members.map((m) => {
              const isExpanded = expandedMemberId === m.user_id;
              return (
                <View key={m.user_id}>
                  <Pressable style={styles.leagueMemberRow} onPress={() => toggleMemberExpand(m.user_id)}>
                    <Pressable onPress={() => openUserProfile(m.user_id)}>
                      <Avatar uri={m.avatar_url} name={m.username} size={34} radius={11} />
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.leagueMemberName}>{m.username}</Text>
                      <Text style={styles.leagueMemberMeta}>
                        {m.games} {m.games === 1 ? "game" : "games"}
                        {m.best_week ? ` · best ${weekLabel(m.best_week, selectedSkeeSeason)}` : ""}
                        {m.worst_week && m.worst_week !== m.best_week ? ` · worst ${weekLabel(m.worst_week, selectedSkeeSeason)}` : ""}
                      </Text>
                    </View>
                    <View style={styles.leagueMemberNums}>
                      <Text style={styles.leagueMemberAvg}>{m.avg}</Text>
                      <Text style={styles.leagueMemberAvgLabel}>avg · {m.best} best</Text>
                    </View>
                    <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color="#333" />
                  </Pressable>
                  {isExpanded && (
                    <View style={styles.leagueMemberDetail}>
                      {!expandedMemberStats ? (
                        <ActivityIndicator size="small" color="#06b6d4" style={{ marginVertical: 12 }} />
                      ) : (
                        <>
                          {expandedMemberInsights && (
                            <View style={{ marginBottom: 10 }}>
                              <InsightChips insights={expandedMemberInsights} />
                            </View>
                          )}
                          <WeeklyBarChart
                            weeks={expandedMemberStats.weeks}
                            season={selectedSkeeSeason}
                            height={90}
                          />
                          <Text style={[styles.leagueSubLabel, { marginTop: 10, marginBottom: 6 }]}>Shot Breakdown</Text>
                          <RingBreakdown rings={expandedMemberStats.totals.rings} compact />
                          {expandedMemberInsights && expandedMemberInsights.lanes.length >= 2 && (
                            <>
                              <Text style={[styles.leagueSubLabel, { marginTop: 10, marginBottom: 6 }]}>Lane Averages</Text>
                              <LaneStats lanes={expandedMemberInsights.lanes} />
                            </>
                          )}
                        </>
                      )}
                    </View>
                  )}
                </View>
              );
            })}

            {/* Compare */}
            <Pressable
              style={styles.compareBtn}
              onPress={() => router.push({ pathname: "/skeeball-compare" as any, params: { teamId: teamId ?? "" } })}
            >
              <Ionicons name="git-compare-outline" size={15} color="#06b6d4" />
              <Text style={styles.compareBtnText}>Compare Players</Text>
            </Pressable>

            {/* Recaps (generated server-side; presented as league write-ups) */}
            {isTeamMember && (
              <>
                <View style={styles.recapBtnRow}>
                  <Pressable
                    style={[styles.recapBtn, recapLoading === "week" && { opacity: 0.6 }]}
                    onPress={() => askRecap("week")}
                    disabled={recapLoading !== null}
                  >
                    {recapLoading === "week"
                      ? <ActivityIndicator size="small" color="#f59e0b" />
                      : <><Ionicons name="newspaper-outline" size={14} color="#f59e0b" /><Text style={styles.recapBtnText}>Weekly Recap</Text></>}
                  </Pressable>
                  <Pressable
                    style={[styles.recapBtn, recapLoading === "season" && { opacity: 0.6 }]}
                    onPress={() => askRecap("season")}
                    disabled={recapLoading !== null}
                  >
                    {recapLoading === "season"
                      ? <ActivityIndicator size="small" color="#f59e0b" />
                      : <><Ionicons name="book-outline" size={14} color="#f59e0b" /><Text style={styles.recapBtnText}>Season Report</Text></>}
                  </Pressable>
                </View>
                {recapError && (
                  <View style={styles.tipRow}>
                    <Ionicons name="alert-circle-outline" size={13} color="#ef4444" />
                    <Text style={[styles.tipText, { color: "#ef4444" }]}>{recapError}</Text>
                  </View>
                )}
                {recapResult && (
                  <View style={styles.recapCard}>
                    <View style={styles.coachResultHeader}>
                      <Ionicons name="newspaper-outline" size={13} color="#f59e0b" />
                      <Text style={[styles.coachResultTitle, { color: "#f59e0b" }]}>
                        {recapResult.mode === "week" ? "This Week's Recap" : "Season Report"}
                      </Text>
                    </View>
                    <Text style={styles.recapText}>{recapResult.recap}</Text>
                    {recapResult.highlights.map((h, i) => (
                      <View key={i} style={styles.tipRow}>
                        <Ionicons name="star-outline" size={12} color="#f59e0b" />
                        <Text style={styles.tipText}>{h}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* ── Lineup Optimizer (team members only — strategy stays private) ── */}
        {isTeamMember && positionStats.length > 0 && (
          <>
            <SectionLabel text="Lineup Optimizer" />
            <View style={styles.leagueCard}>
              <Text style={styles.coachHint}>
                Position averages follow each player across every team they've played on.
              </Text>
              {/* Per-position averages table */}
              <View style={styles.posTableHead}>
                <Text style={[styles.posTableCell, { flex: 1.6, textAlign: "left" }]}>Player</Text>
                <Text style={styles.posTableCell}>1st</Text>
                <Text style={styles.posTableCell}>2nd</Text>
                <Text style={styles.posTableCell}>3rd</Text>
              </View>
              {positionStats.map((p) => {
                const best = Math.max(...[1, 2, 3].map((pos) => p.positions[String(pos) as "1" | "2" | "3"]?.avg ?? -1));
                return (
                  <View key={p.user_id} style={styles.posTableRow}>
                    <Text style={[styles.posTableName, { flex: 1.6 }]} numberOfLines={1}>{p.username}</Text>
                    {[1, 2, 3].map((pos) => {
                      const st = p.positions[String(pos) as "1" | "2" | "3"];
                      const isBest = st && st.avg === best && best >= 0;
                      return (
                        <Text key={pos} style={[styles.posTableCell, isBest && { color: "#22c55e", fontWeight: "900" }]}>
                          {st ? st.avg : "—"}
                        </Text>
                      );
                    })}
                  </View>
                );
              })}

              {/* Statistical suggestion */}
              {(() => {
                const suggestion: OrderSuggestion | null = suggestOrder(positionStats);
                if (!suggestion) return (
                  <Text style={styles.coachHint}>Play more league games to unlock order suggestions.</Text>
                );
                return (
                  <>
                    <Text style={[styles.leagueSubLabel, { marginTop: 10 }]}>Suggested Order (season data)</Text>
                    <View style={styles.suggestRow}>
                      {suggestion.order.map((o) => (
                        <View key={o.user_id} style={styles.suggestChip}>
                          <Text style={styles.suggestChipPos}>{o.position}</Text>
                          <Text style={styles.suggestChipName} numberOfLines={1}>{o.username}</Text>
                        </View>
                      ))}
                    </View>
                    {suggestion.tips.map((tip, i) => (
                      <View key={i} style={styles.tipRow}>
                        <Ionicons name="bulb-outline" size={13} color="#f59e0b" />
                        <Text style={styles.tipText}>{tip}</Text>
                      </View>
                    ))}
                  </>
                );
              })()}

              {/* Matchup planner (model-assisted server-side; presented as a stats feature) */}
              <View style={styles.coachDivider} />
              <Text style={styles.leagueSubLabel}>Matchup Planner</Text>
              <Pressable style={styles.opponentSelect} onPress={openOpponentPicker}>
                <Ionicons name="people-outline" size={14} color="#a855f7" />
                <Text style={styles.opponentSelectText}>
                  {coachOpponent ? `vs ${coachOpponent.name}` : "Optional: pick this week's opponent"}
                </Text>
                {coachOpponent && (
                  <Pressable onPress={() => setCoachOpponent(null)} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color="#555" />
                  </Pressable>
                )}
                <Ionicons name="chevron-down" size={13} color="#555" />
              </Pressable>
              {coachOpponent && headToHead && headToHead.meetings > 0 && (
                <View style={styles.h2hCard}>
                  <Text style={styles.h2hTitle}>vs {coachOpponent.name} ({selectedSkeeSeason ? selectedSkeeSeason.name : "all time"})</Text>
                  <Text style={styles.h2hLine}>
                    {headToHead.wins}W – {headToHead.losses}L over {headToHead.meetings} {headToHead.meetings === 1 ? "meeting" : "meetings"}
                    {" · "}avg margin {headToHead.avg_margin >= 0 ? "+" : ""}{headToHead.avg_margin} pts
                  </Text>
                </View>
              )}
              <Pressable
                style={[styles.coachBtn, coachLoading && { opacity: 0.6 }]}
                onPress={askCoach}
                disabled={coachLoading}
              >
                {coachLoading
                  ? <ActivityIndicator size="small" color="#000" />
                  : <>
                      <Ionicons name="clipboard-outline" size={15} color="#000" />
                      <Text style={styles.coachBtnText}>
                        {coachOpponent ? "Analyze Matchup" : "Analyze My Team"}
                      </Text>
                    </>}
              </Pressable>
              {coachError && (
                <View style={styles.tipRow}>
                  <Ionicons name="alert-circle-outline" size={13} color="#ef4444" />
                  <Text style={[styles.tipText, { color: "#ef4444" }]}>{coachError}</Text>
                </View>
              )}
              {coachResult && (
                <View style={styles.coachResult}>
                  <View style={styles.coachResultHeader}>
                    <Ionicons name="clipboard-outline" size={13} color="#a855f7" />
                    <Text style={styles.coachResultTitle}>Coach's Call</Text>
                    <View style={[styles.confChip, {
                      backgroundColor: coachResult.confidence === "high" ? "rgba(34,197,94,0.12)" : coachResult.confidence === "medium" ? "rgba(245,158,11,0.12)" : "rgba(100,100,100,0.12)",
                    }]}>
                      <Text style={[styles.confChipText, {
                        color: coachResult.confidence === "high" ? "#22c55e" : coachResult.confidence === "medium" ? "#f59e0b" : "#777",
                      }]}>{coachResult.confidence === "high" ? "strong data" : coachResult.confidence === "medium" ? "decent data" : "thin data"}</Text>
                    </View>
                  </View>
                  {coachResult.order.map((o) => (
                    <View key={o.position} style={styles.coachOrderRow}>
                      <View style={styles.suggestChipPosWrap}>
                        <Text style={styles.suggestChipPos}>{o.position}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.coachOrderName}>{o.username}</Text>
                        <Text style={styles.coachOrderReason}>{o.reason}</Text>
                      </View>
                    </View>
                  ))}
                  {coachResult.tips.map((tip, i) => (
                    <View key={i} style={styles.tipRow}>
                      <Ionicons name="bulb-outline" size={13} color="#a855f7" />
                      <Text style={styles.tipText}>{tip}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </>
        )}

        {/* ── Season Schedule ── */}
        {(weekHistory?.upcoming || (weekHistory?.weeks.length ?? 0) > 0 || isTeamMember) && (
          <>
            <SectionLabel text="Season Schedule" />
            <View style={styles.leagueCard}>
              {(weekHistory?.upcoming || isTeamMember) && (
                <View style={{ gap: 8, marginBottom: 6 }}>
                  {weekHistory?.upcoming && (
                    <View style={styles.upcomingRow}>
                      <View style={styles.upcomingIcon}>
                        <Ionicons name="calendar-outline" size={16} color="#22c55e" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.upcomingTitle}>
                          This week · {weekHistory.upcoming.slot_time}
                        </Text>
                        <Text style={styles.upcomingSub}>
                          {weekLabel(weekHistory.upcoming.week_of, selectedSkeeSeason)}
                          {weekHistory.upcoming.week_label ? ` · ${weekHistory.upcoming.week_label}` : ""}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* RSVP (members only) */}
                  {isTeamMember && (
                    <View style={styles.rsvpRow}>
                      <Text style={styles.rsvpLabel}>Are you in Monday?</Text>
                      <Pressable
                        style={[styles.rsvpBtn, rsvps[user?.id ?? ""] === "in" && styles.rsvpBtnIn]}
                        onPress={() => setMyRsvp(weekHistory?.upcoming?.week_of ?? currentMondayStr(), "in")}
                        disabled={savingRsvp}
                      >
                        <Text style={[styles.rsvpBtnText, rsvps[user?.id ?? ""] === "in" && { color: "#000" }]}>In</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.rsvpBtn, rsvps[user?.id ?? ""] === "out" && styles.rsvpBtnOut]}
                        onPress={() => setMyRsvp(weekHistory?.upcoming?.week_of ?? currentMondayStr(), "out")}
                        disabled={savingRsvp}
                      >
                        <Text style={[styles.rsvpBtnText, rsvps[user?.id ?? ""] === "out" && { color: "#fff" }]}>Out</Text>
                      </Pressable>
                    </View>
                  )}

                  {/* Teammate RSVP status + sub request */}
                  {isTeamMember && members.length > 0 && (
                    <View style={styles.rsvpStatusRow}>
                      <Text style={styles.rsvpStatusText}>
                        {members.map((m) => `${m.username}: ${rsvps[m.user_id] === "in" ? "✅" : rsvps[m.user_id] === "out" ? "❌" : "—"}`).join("   ")}
                      </Text>
                      {openSubRequest ? (
                        <View style={[styles.subChip, openSubRequest.status === "filled" && { borderColor: "rgba(34,197,94,0.4)" }]}>
                          <Text style={[styles.subChipText, openSubRequest.status === "filled" && { color: "#22c55e" }]}>
                            {openSubRequest.status === "filled" ? "Sub found ✓" : "Sub requested…"}
                          </Text>
                        </View>
                      ) : Object.values(rsvps).includes("out") ? (
                        <Pressable
                          style={styles.subChip}
                          onPress={() => requestSub(weekHistory?.upcoming?.week_of ?? currentMondayStr())}
                          disabled={requestingSub}
                        >
                          {requestingSub
                            ? <ActivityIndicator size="small" color="#f59e0b" />
                            : <Text style={styles.subChipText}>Request a Sub</Text>}
                        </Pressable>
                      ) : null}
                    </View>
                  )}
                </View>
              )}
              {(weekHistory?.weeks ?? []).slice().reverse().map((w) => (
                <View key={w.week_of} style={styles.histRow}>
                  <View style={styles.histWeekCol}>
                    <Text style={styles.histWeek}>{weekLabel(w.week_of, selectedSkeeSeason)}</Text>
                    {w.slot_time && <Text style={styles.histSlot}>{w.slot_time}</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.histResult}>
                      {w.placement === 1 ? "🥇" : w.placement === 2 ? "🥈" : w.placement === 3 ? "🥉" : w.placement ? `${w.placement}th` : "—"}
                      {"  "}{w.game_score} pts · +{w.points} LP
                    </Text>
                    {w.opponents.length > 0 && (
                      <Text style={styles.histOpponents} numberOfLines={2}>
                        vs {w.opponents.map((o) => `${o.team_name} (${o.game_score})`).join(", ")}
                      </Text>
                    )}
                    {isTeamMember && Date.now() - new Date(w.week_of).getTime() < 8 * 86400000 && (
                      <Pressable
                        onPress={() => { setDisputeSessionId((w as any).session_id ?? null); setDisputeVisible(true); }}
                        hitSlop={6}
                      >
                        <Text style={styles.disputeLink}>Something wrong? Dispute this score</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ))}
              {(weekHistory?.weeks.length ?? 0) === 0 && !weekHistory?.upcoming && (
                <Text style={styles.coachHint}>No scheduled weeks yet.</Text>
              )}
            </View>
          </>
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
          <PlayerRow
            key={p.user_id}
            player={p}
            rank={i + 1}
            captainMode={isCaptain && p.user_id !== user?.id}
            onActionPress={() => setMemberActionTarget({ userId: p.user_id, username: p.username })}
          />
        ))}

        {members.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyCardText}>No members yet.</Text>
          </View>
        )}

        {isCaptain && bannedUsers.length > 0 && (
          <>
            <SectionLabel text={`Banned · ${bannedUsers.length}`} />
            <View style={{ marginHorizontal: 20, marginBottom: 28 }}>
              {bannedUsers.map((b) => (
                <View key={b.user_id} style={styles.bannedRow}>
                  <Avatar uri={null} name={b.username} size={36} radius={11} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bannedUsername}>{b.username}</Text>
                    <Text style={styles.bannedDate}>Banned {fmtRelTime(b.banned_at)}</Text>
                  </View>
                  <Pressable style={styles.unbanBtn} onPress={() => handleUnban(b.user_id, b.username)}>
                    <Text style={styles.unbanBtnText}>Unban</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* League season picker */}
      <Modal visible={skeePickerVisible} transparent animationType="slide" onRequestClose={() => setSkeePickerVisible(false)}>
        <Pressable style={styles.modalBg} onPress={() => setSkeePickerVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>League Season</Text>
            <Text style={styles.modalSub}>Each season is 8 weeks</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <Pressable
                style={[styles.seasonRow, selectedSkeeSeasonId === "all" && styles.seasonRowActive]}
                onPress={() => { setSelectedSkeeSeasonId("all"); setSkeePickerVisible(false); }}
              >
                <Text style={[styles.seasonRowLabel, selectedSkeeSeasonId === "all" && styles.seasonRowLabelActive]}>All Time</Text>
                {selectedSkeeSeasonId === "all" && <Ionicons name="checkmark-circle" size={20} color="#06b6d4" />}
              </Pressable>
              {skeeSeasons.map((sn) => {
                const active = selectedSkeeSeasonId === sn.id;
                return (
                  <Pressable
                    key={sn.id}
                    style={[styles.seasonRow, active && styles.seasonRowActive]}
                    onPress={() => { setSelectedSkeeSeasonId(sn.id); setSkeePickerVisible(false); }}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={[styles.seasonRowLabel, active && styles.seasonRowLabelActive]}>{sn.name}</Text>
                        {sn.status === "active" && (
                          <View style={styles.liveSeasonChip}><Text style={styles.liveSeasonChipText}>LIVE</Text></View>
                        )}
                      </View>
                      <Text style={styles.seasonRowRange}>
                        {new Date(sn.start_week).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        {" – "}
                        {new Date(sn.end_week).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </Text>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={20} color="#06b6d4" />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Invite player (captain) */}
      <Modal visible={inviteVisible} transparent animationType="slide" onRequestClose={() => setInviteVisible(false)}>
        <Pressable style={styles.modalBg} onPress={() => setInviteVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Invite Player</Text>
            {inviteSentTo ? (
              <View style={{ alignItems: "center", paddingVertical: 20, gap: 10 }}>
                <Ionicons name="checkmark-circle" size={30} color="#22c55e" />
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800" }}>Invite sent to {inviteSentTo}!</Text>
                <Pressable style={styles.renameSaveBtn} onPress={() => setInviteSentTo(null)}>
                  <Text style={styles.renameSaveText}>Invite another</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <TextInput
                  style={styles.renameInput}
                  placeholder="Search by username…"
                  placeholderTextColor="#555"
                  autoFocus
                  autoCapitalize="none"
                  value={inviteSearch}
                  onChangeText={searchInviteUsers}
                />
                <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled">
                  {inviteSearching && <ActivityIndicator color="#06b6d4" style={{ marginVertical: 12 }} />}
                  {inviteResults.map((u) => (
                    <Pressable
                      key={u.id}
                      style={styles.inviteResultRow}
                      onPress={() => handleInviteUser(u.id, u.username)}
                      disabled={inviting}
                    >
                      <Avatar uri={null} name={u.username} size={36} />
                      <Text style={styles.inviteResultName}>{u.username}</Text>
                      <View style={styles.inviteSendChip}>
                        <Ionicons name="paper-plane-outline" size={13} color="#000" />
                        <Text style={styles.inviteSendChipText}>Invite</Text>
                      </View>
                    </Pressable>
                  ))}
                  {inviteSearch.trim() !== "" && inviteResults.length === 0 && !inviteSearching && (
                    <Text style={{ color: "#777", textAlign: "center", paddingVertical: 16 }}>No users found</Text>
                  )}
                </ScrollView>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Join requests (captain) */}
      <Modal visible={requestsVisible} transparent animationType="slide" onRequestClose={() => setRequestsVisible(false)}>
        <Pressable style={styles.modalBg} onPress={() => setRequestsVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Join Requests</Text>
            {requestsLoading ? (
              <ActivityIndicator color="#06b6d4" style={{ marginVertical: 20 }} />
            ) : joinRequests.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 24, gap: 8 }}>
                <Ionicons name="checkmark-done-circle-outline" size={36} color="#2a2a2a" />
                <Text style={{ color: "#777", fontSize: 14 }}>No pending requests</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 380 }}>
                {joinRequests.map((r) => (
                  <View key={r.id} style={styles.inviteResultRow}>
                    <Pressable onPress={() => { setRequestsVisible(false); openUserProfile(r.user_id); }}>
                      <Avatar uri={null} name={r.username} size={36} />
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inviteResultName}>{r.username}</Text>
                      {r.message ? <Text style={{ color: "#777", fontSize: 12, marginTop: 2 }}>{r.message}</Text> : null}
                    </View>
                    <Pressable style={styles.reqApproveBtn} onPress={() => approveJoinRequest(r.id, r.user_id)}>
                      <Ionicons name="checkmark" size={16} color="#000" />
                    </Pressable>
                    <Pressable style={styles.reqDenyBtn} onPress={() => denyJoinRequest(r.id)}>
                      <Ionicons name="close" size={16} color="#ef4444" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Score dispute */}
      <Modal visible={disputeVisible} transparent animationType="slide" onRequestClose={() => setDisputeVisible(false)}>
        <Pressable style={styles.modalBg} onPress={() => setDisputeVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Dispute Score</Text>
            <Text style={styles.modalSub}>
              Tell the admins what was entered incorrectly. They'll review the ball-by-ball record and adjust if needed.
            </Text>
            <TextInput
              style={styles.renameInput}
              placeholder="e.g. Our 7th ball was a 50, not a 20…"
              placeholderTextColor="#555"
              value={disputeReason}
              onChangeText={setDisputeReason}
              multiline
              maxLength={500}
              autoFocus
            />
            <Pressable
              style={[styles.renameSaveBtn, { backgroundColor: "#ef4444" }, (disputeReason.trim().length < 5 || raisingDispute) && { opacity: 0.4 }]}
              onPress={raiseDispute}
              disabled={disputeReason.trim().length < 5 || raisingDispute}
            >
              {raisingDispute
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={[styles.renameSaveText, { color: "#fff" }]}>Submit Dispute</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Opponent picker (AI coach) */}
      <Modal visible={opponentPickerVisible} transparent animationType="slide" onRequestClose={() => setOpponentPickerVisible(false)}>
        <Pressable style={styles.modalBg} onPress={() => setOpponentPickerVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Pick Opponent</Text>
            <Text style={styles.modalSub}>The coach will factor in their season data</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {opponentOptions.map((t) => (
                <Pressable
                  key={t.id}
                  style={[styles.seasonRow, coachOpponent?.id === t.id && styles.seasonRowActive]}
                  onPress={() => { setCoachOpponent(t); setOpponentPickerVisible(false); }}
                >
                  <Text style={[styles.seasonRowLabel, coachOpponent?.id === t.id && styles.seasonRowLabelActive]}>{t.name}</Text>
                  {coachOpponent?.id === t.id && <Ionicons name="checkmark-circle" size={20} color="#a855f7" />}
                </Pressable>
              ))}
              {opponentOptions.length === 0 && (
                <ActivityIndicator color="#a855f7" style={{ marginVertical: 24 }} />
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Team settings (captain gear) */}
      <Modal visible={teamSettingsVisible} transparent animationType="slide" onRequestClose={() => setTeamSettingsVisible(false)}>
        <Pressable style={styles.modalBg} onPress={() => setTeamSettingsVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Team Settings</Text>
            <Text style={styles.modalSub}>{displayName ?? teamName}</Text>
            <Pressable
              style={styles.settingsRow}
              onPress={() => { setTeamSettingsVisible(false); setTimeout(() => setPhotoSourceVisible(true), 150); }}
            >
              <Ionicons name="camera-outline" size={19} color="#06b6d4" />
              <Text style={styles.settingsRowText}>Change Team Photo</Text>
              <Ionicons name="chevron-forward" size={15} color="#333" />
            </Pressable>
            <Pressable
              style={styles.settingsRow}
              onPress={() => {
                setTeamSettingsVisible(false);
                setTimeout(() => { setEditSlot1(slotPref1); setEditSlot2(slotPref2); setEditSlotsVisible(true); }, 150);
              }}
            >
              <Ionicons name="time-outline" size={19} color="#06b6d4" />
              <Text style={styles.settingsRowText}>Preferred Play Times</Text>
              <Ionicons name="chevron-forward" size={15} color="#333" />
            </Pressable>
            <Pressable
              style={styles.settingsRow}
              onPress={() => {
                setTeamSettingsVisible(false);
                setTimeout(() => { setRenameText(displayName ?? teamName ?? ""); setRenameVisible(true); }, 150);
              }}
            >
              <Ionicons name="pencil-outline" size={19} color="#06b6d4" />
              <Text style={styles.settingsRowText}>Rename Team</Text>
              <Ionicons name="chevron-forward" size={15} color="#333" />
            </Pressable>
            <Pressable
              style={styles.settingsRow}
              onPress={() => {
                setTeamSettingsVisible(false);
                setTimeout(() => { setInviteSentTo(null); setInviteSearch(""); setInviteResults([]); setInviteVisible(true); }, 150);
              }}
            >
              <Ionicons name="person-add-outline" size={19} color="#06b6d4" />
              <Text style={styles.settingsRowText}>Invite Player</Text>
              <Ionicons name="chevron-forward" size={15} color="#333" />
            </Pressable>
            <Pressable
              style={[styles.settingsRow, { borderBottomWidth: 0 }]}
              onPress={() => {
                setTeamSettingsVisible(false);
                setTimeout(() => { setRequestsVisible(true); loadJoinRequests(); }, 150);
              }}
            >
              <Ionicons name="people-outline" size={19} color="#06b6d4" />
              <Text style={styles.settingsRowText}>Join Requests</Text>
              {pendingReqCount > 0 && (
                <View style={styles.reqCountDot}><Text style={styles.reqCountDotText}>{pendingReqCount}</Text></View>
              )}
              <Ionicons name="chevron-forward" size={15} color="#333" />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Rename team */}
      <Modal visible={renameVisible} transparent animationType="slide" onRequestClose={() => setRenameVisible(false)}>
        <Pressable style={styles.modalBg} onPress={() => setRenameVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Rename Team</Text>
            <Text style={styles.modalSub}>Current name: {displayName ?? teamName}</Text>
            <TextInput
              style={styles.renameInput}
              value={renameText}
              onChangeText={setRenameText}
              placeholder="New team name"
              placeholderTextColor="#555"
              autoFocus
              maxLength={40}
              returnKeyType="done"
              onSubmitEditing={handleRenameTeam}
            />
            <Pressable
              style={[styles.renameSaveBtn, (renaming || !renameText.trim()) && { opacity: 0.4 }]}
              onPress={handleRenameTeam}
              disabled={renaming || !renameText.trim()}
            >
              {renaming
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={styles.renameSaveText}>Save</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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

      {/* Member action sheet (kick / ban) */}
      <Modal visible={!!memberActionTarget} transparent animationType="slide" onRequestClose={() => setMemberActionTarget(null)}>
        <Pressable style={styles.modalBg} onPress={() => setMemberActionTarget(null)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{memberActionTarget?.username}</Text>
            <Text style={styles.modalSub}>Choose an action for this member</Text>

            <Pressable
              style={styles.kickActionBtn}
              disabled={kickingId === memberActionTarget?.userId}
              onPress={() => {
                const target = memberActionTarget;
                setMemberActionTarget(null);
                if (target) handleKick(target.userId);
              }}
            >
              <Ionicons name="exit-outline" size={20} color="#f59e0b" />
              <View style={{ flex: 1 }}>
                <Text style={styles.kickActionText}>Kick from team</Text>
                <Text style={styles.kickActionSub}>Removed but can request to rejoin</Text>
              </View>
            </Pressable>

            <Pressable
              style={styles.banActionBtn}
              disabled={banningId === memberActionTarget?.userId}
              onPress={() => {
                const target = memberActionTarget;
                setMemberActionTarget(null);
                if (target) handleBan(target.userId);
              }}
            >
              <Ionicons name="ban-outline" size={20} color="#ef4444" />
              <View style={{ flex: 1 }}>
                <Text style={styles.banActionText}>Ban from team</Text>
                <Text style={styles.banActionSub}>Blocked from searching or joining</Text>
              </View>
            </Pressable>

            <Pressable style={styles.memberActionCancel} onPress={() => setMemberActionTarget(null)}>
              <Text style={styles.memberActionCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
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

function PlayerRow({ player, rank, captainMode, onActionPress }: {
  player: PlayerStats;
  rank: number;
  captainMode?: boolean;
  onActionPress?: () => void;
}) {
  const hasScores = player.games > 0;
  return (
    <View style={styles.playerCard}>
      {/* Left: rank + avatar + name */}
      <View style={styles.playerLeft}>
        <Text style={styles.rankNum}>#{rank}</Text>
        <Pressable style={[{ opacity: hasScores ? 1 : 0.4 }]} onPress={() => openUserProfile(player.user_id)}>
          <Avatar uri={player.avatar_url} name={player.username} size={44} radius={14} />
        </Pressable>
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

      {captainMode && (
        <Pressable style={styles.memberActionBtn} onPress={onActionPress} hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={16} color="#888" />
        </Pressable>
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
  teamSub: { color: "#8a8a8a", fontSize: 13 },
  activeLaneBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(34,197,94,0.06)", borderRadius: 12,
    borderWidth: 1, borderColor: "rgba(34,197,94,0.25)",
    paddingHorizontal: 12, paddingVertical: 8, marginTop: 10,
  },
  activeLaneText: { flex: 1, color: "#22c55e", fontSize: 13, fontWeight: "800" },
  checkoutBtn: {
    borderWidth: 1, borderColor: "rgba(239,68,68,0.4)", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  checkoutBtnText: { color: "#ef4444", fontSize: 12.5, fontWeight: "800" },

  heroStatsRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#0d0d0d", borderRadius: 14,
    borderWidth: 1, borderColor: "#1a1a1a",
    paddingVertical: 10, paddingHorizontal: 8,
    marginTop: 12, alignSelf: "stretch", marginHorizontal: 16,
  },
  heroStat: { flex: 1, alignItems: "center", gap: 2 },
  heroStatValue: { color: "#fff", fontSize: 17, fontWeight: "900" },
  heroStatLabel: { color: "#666", fontSize: 10.5, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  heroStatDivider: { width: 1, height: 26, backgroundColor: "#1e1e1e" },
  trackActions: { flexDirection: "row", gap: 10, marginTop: 16, flexWrap: "wrap", justifyContent: "center" },
  trackBtn: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "#06b6d4", borderRadius: 20,
    paddingHorizontal: 18, paddingVertical: 10,
  },
  trackBtnText: { color: "#000", fontWeight: "900", fontSize: 14 },
  trackManualBtn: { backgroundColor: "rgba(6,182,212,0.1)", borderWidth: 1, borderColor: "rgba(6,182,212,0.3)" },
  trackManualBtnText: { color: "#06b6d4", fontWeight: "900", fontSize: 14 },

  seasonPill: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#111", borderRadius: 18,
    paddingHorizontal: 18, paddingVertical: 12,
    borderWidth: 1, borderColor: "#1e1e1e",
    marginHorizontal: 20, marginBottom: 32,
  },
  seasonPillLabel: { color: "#fff", fontSize: 14, fontWeight: "800" },
  seasonPillRange: { color: "#777", fontSize: 11, marginTop: 1 },

  sectionLabel: {
    color: "#777", fontSize: 11, fontWeight: "700",
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
  statSub: { color: "#777", fontSize: 11, fontWeight: "600", marginTop: -2 },
  statLabel: { color: "#8a8a8a", fontSize: 12, fontWeight: "600", marginTop: 4 },

  emptyCard: {
    backgroundColor: "#0d0d0d", borderRadius: 18,
    padding: 32, alignItems: "center", gap: 10,
    marginHorizontal: 20, marginBottom: 28,
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  emptyCardText: { color: "#777", fontSize: 14, textAlign: "center" },

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
  playerMeta: { color: "#8a8a8a", fontSize: 12 },
  playerMetaDim: { color: "#333", fontSize: 12, fontStyle: "italic" },

  playerRight: { flexDirection: "row", gap: 16, paddingLeft: 8 },
  pip: { alignItems: "center" },
  pipVal: { fontSize: 15, fontWeight: "900" },
  pipLabel: { color: "#333", fontSize: 10, fontWeight: "700", marginTop: 1 },

  // Modal
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalSheet: {
    width: "100%", maxWidth: 560, alignSelf: "center",
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40,
    borderTopWidth: 1, borderColor: "#1e1e1e",
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 20 },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  modalSub: { color: "#8a8a8a", fontSize: 13, marginBottom: 20 },
  seasonRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  seasonRowActive: {},
  seasonRowLabel: { color: "#777", fontSize: 16, fontWeight: "700" },
  seasonRowLabelActive: { color: "#fff" },
  seasonRowRange: { color: "#333", fontSize: 12, marginTop: 2 },

  // League performance section
  leagueHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 20 },
  leagueSeasonPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(245,158,11,0.07)", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6, marginBottom: 12,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
  },
  leagueSeasonPillText: { color: "#f59e0b", fontSize: 12, fontWeight: "800" },
  leagueCard: {
    backgroundColor: "#111", borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: "#1e1e1e",
    marginHorizontal: 20, marginBottom: 28, gap: 10,
  },
  leagueSummaryRow: { flexDirection: "row", gap: 8 },
  leagueSummaryBox: {
    flex: 1, backgroundColor: "#0c0c0c", borderRadius: 12, paddingVertical: 10,
    alignItems: "center", borderWidth: 1, borderColor: "#191919",
  },
  leagueSummaryValue: { color: "#06b6d4", fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
  leagueSummaryLabel: { color: "#777", fontSize: 9.5, fontWeight: "700", marginTop: 2 },
  leagueChartHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  leagueSubLabel: {
    color: "#6b6b6b", fontSize: 10, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.2,
  },
  leagueMemberRow: {
    flexDirection: "row", alignItems: "center", gap: 11,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  leagueMemberName: { color: "#fff", fontSize: 14, fontWeight: "800" },
  leagueMemberMeta: { color: "#777", fontSize: 11, marginTop: 1 },
  leagueMemberNums: { alignItems: "flex-end" },
  leagueMemberAvg: { color: "#06b6d4", fontSize: 16, fontWeight: "900" },
  leagueMemberAvgLabel: { color: "#6b6b6b", fontSize: 10 },
  leagueMemberDetail: {
    backgroundColor: "#0c0c0c", borderRadius: 12, padding: 12, marginVertical: 8,
    borderWidth: 1, borderColor: "#191919",
  },
  compareBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    backgroundColor: "rgba(6,182,212,0.07)", borderRadius: 12, paddingVertical: 12, marginTop: 6,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.2)",
  },
  compareBtnText: { color: "#06b6d4", fontSize: 13, fontWeight: "800" },
  liveSeasonChip: { backgroundColor: "rgba(34,197,94,0.12)", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  liveSeasonChipText: { color: "#22c55e", fontSize: 9, fontWeight: "900" },

  // Lineup optimizer
  posTableHead: { flexDirection: "row", paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e1e1e" },
  posTableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#181818" },
  posTableCell: { flex: 1, color: "#666", fontSize: 12.5, fontWeight: "700", textAlign: "center" },
  posTableName: { color: "#fff", fontSize: 13.5, fontWeight: "800" },
  suggestRow: { flexDirection: "row", gap: 8, marginTop: 4, marginBottom: 6 },
  suggestChip: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "rgba(34,197,94,0.07)", borderRadius: 12, padding: 9,
    borderWidth: 1, borderColor: "rgba(34,197,94,0.2)",
  },
  suggestChipPosWrap: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(34,197,94,0.15)", alignItems: "center", justifyContent: "center",
  },
  suggestChipPos: {
    width: 20, height: 20, borderRadius: 10, overflow: "hidden",
    backgroundColor: "rgba(34,197,94,0.15)", color: "#22c55e",
    fontSize: 11, fontWeight: "900", textAlign: "center", lineHeight: 20,
  },
  suggestChipName: { flex: 1, color: "#fff", fontSize: 12, fontWeight: "800" },
  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: 7, marginTop: 6 },
  tipText: { flex: 1, color: "#999", fontSize: 12.5, lineHeight: 18 },
  coachHint: { color: "#777", fontSize: 12.5, marginTop: 8 },
  coachDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#1e1e1e", marginVertical: 12 },
  opponentSelect: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#0c0c0c", borderRadius: 12, padding: 11, marginTop: 6,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  opponentSelectText: { flex: 1, color: "#888", fontSize: 13, fontWeight: "600" },
  coachBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    backgroundColor: "#a855f7", borderRadius: 12, paddingVertical: 12, marginTop: 8,
  },
  coachBtnText: { color: "#000", fontSize: 13.5, fontWeight: "900" },
  coachResult: {
    backgroundColor: "rgba(168,85,247,0.05)", borderRadius: 14, padding: 12, marginTop: 10,
    borderWidth: 1, borderColor: "rgba(168,85,247,0.2)", gap: 8,
  },
  coachResultHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  coachResultTitle: { flex: 1, color: "#a855f7", fontSize: 13, fontWeight: "900" },
  confChip: { borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 },
  confChipText: { fontSize: 10, fontWeight: "800" },
  coachOrderRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  coachOrderName: { color: "#fff", fontSize: 13.5, fontWeight: "800" },
  coachOrderReason: { color: "#777", fontSize: 12, lineHeight: 17, marginTop: 1 },

  // RSVP + subs + disputes
  rsvpRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  rsvpLabel: { flex: 1, color: "#ccc", fontSize: 13, fontWeight: "700" },
  rsvpBtn: {
    borderRadius: 10, paddingHorizontal: 18, paddingVertical: 8,
    borderWidth: 1, borderColor: "#2a2a2a", backgroundColor: "#161616",
  },
  rsvpBtnIn: { backgroundColor: "#22c55e", borderColor: "#22c55e" },
  rsvpBtnOut: { backgroundColor: "#ef4444", borderColor: "#ef4444" },
  rsvpBtnText: { color: "#8a8a8a", fontSize: 13, fontWeight: "800" },
  rsvpStatusRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  rsvpStatusText: { flex: 1, color: "#8a8a8a", fontSize: 11.5, lineHeight: 17 },
  subChip: {
    borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7,
    backgroundColor: "rgba(245,158,11,0.08)",
    borderWidth: 1, borderColor: "rgba(245,158,11,0.35)",
  },
  subChipText: { color: "#f59e0b", fontSize: 12, fontWeight: "800" },
  disputeLink: { color: "#ef4444", fontSize: 11, fontWeight: "600", marginTop: 4, opacity: 0.8 },

  // Head-to-head + recaps
  h2hCard: {
    backgroundColor: "rgba(6,182,212,0.04)", borderRadius: 12, padding: 11, marginTop: 8,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.15)",
  },
  h2hTitle: { color: "#06b6d4", fontSize: 12, fontWeight: "800", marginBottom: 3 },
  h2hLine: { color: "#999", fontSize: 12.5 },
  recapBtnRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  recapBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "rgba(245,158,11,0.07)", borderRadius: 12, paddingVertical: 11,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
  },
  recapBtnText: { color: "#f59e0b", fontSize: 12.5, fontWeight: "800" },
  recapCard: {
    backgroundColor: "rgba(245,158,11,0.04)", borderRadius: 14, padding: 12, marginTop: 10,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)", gap: 8,
  },
  recapText: { color: "#ccc", fontSize: 13.5, lineHeight: 20 },

  // Season schedule
  upcomingRow: {
    flexDirection: "row", alignItems: "center", gap: 11,
    backgroundColor: "rgba(34,197,94,0.05)", borderRadius: 12, padding: 11, marginBottom: 6,
    borderWidth: 1, borderColor: "rgba(34,197,94,0.18)",
  },
  upcomingIcon: {
    width: 34, height: 34, borderRadius: 11,
    backgroundColor: "rgba(34,197,94,0.1)", alignItems: "center", justifyContent: "center",
  },
  upcomingTitle: { color: "#22c55e", fontSize: 14, fontWeight: "800" },
  upcomingSub: { color: "#8a8a8a", fontSize: 11.5, marginTop: 1 },
  histRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  histWeekCol: { width: 64 },
  histWeek: { color: "#fff", fontSize: 13, fontWeight: "800" },
  histSlot: { color: "#06b6d4", fontSize: 10.5, fontWeight: "700", marginTop: 2 },
  histResult: { color: "#ccc", fontSize: 13, fontWeight: "700" },
  histOpponents: { color: "#8a8a8a", fontSize: 11.5, marginTop: 2, lineHeight: 16 },

  settingsRow: {
    flexDirection: "row", alignItems: "center", gap: 13,
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  settingsRowText: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700" },
  reqCountDot: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  reqCountDotText: { color: "#000", fontSize: 11, fontWeight: "900" },
  gearDot: { position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: "#06b6d4" },
  inviteResultRow: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  inviteResultName: { flex: 1, color: "#fff", fontSize: 14.5, fontWeight: "700" },
  inviteSendChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#06b6d4", borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7,
  },
  inviteSendChipText: { color: "#000", fontSize: 12.5, fontWeight: "800" },
  reqApproveBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center" },
  reqDenyBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: "#2a2a2a", alignItems: "center", justifyContent: "center" },
  renameInput: {
    backgroundColor: "#0a0a0a", color: "#fff", padding: 15, borderRadius: 14,
    fontSize: 16, borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 12,
  },
  renameSaveBtn: {
    backgroundColor: "#06b6d4", borderRadius: 14, padding: 15, alignItems: "center",
  },
  renameSaveText: { color: "#000", fontWeight: "900", fontSize: 15 },

  photoPickerBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  photoPickerDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  photoPickerSheet: {
    width: "100%", maxWidth: 560, alignSelf: "center",
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
  photoPickerCancelText: { color: "#8a8a8a", fontWeight: "700", fontSize: 15 },

  // Slot preferences
  slotPrefRow: {
    flexDirection: "row", alignItems: "center", gap: 7, marginTop: 14,
    backgroundColor: "#0d0d0d", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  slotPrefText: { color: "#8a8a8a", fontSize: 13, fontWeight: "600", flex: 1 },
  slotEditBtn: {
    width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(6,182,212,0.1)",
    alignItems: "center", justifyContent: "center",
  },

  // Slot modal
  slotModalLabel: { color: "#8a8a8a", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, marginTop: 6 },
  slotModalRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  slotChip: {
    flex: 1, paddingVertical: 11, borderRadius: 12,
    backgroundColor: "#1a1a1a", alignItems: "center",
    borderWidth: 1, borderColor: "#2a2a2a",
  },
  slotChipActive: { backgroundColor: "rgba(6,182,212,0.15)", borderColor: "#06b6d4" },
  slotChipActive2: { backgroundColor: "rgba(99,102,241,0.15)", borderColor: "#6366f1" },
  slotChipText: { color: "#8a8a8a", fontSize: 13, fontWeight: "700" },
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
    color: "#777", fontSize: 11, fontWeight: "700",
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

  // Member action button (captain ···)
  memberActionBtn: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    marginLeft: 4,
    backgroundColor: "#1e1e1e",
    borderWidth: 1, borderColor: "#2a2a2a",
  },

  // Banned gate screen
  bannedGate: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  bannedGateTitle: { color: "#fff", fontSize: 22, fontWeight: "900", marginBottom: 8 },
  bannedGateSub: { color: "#8a8a8a", fontSize: 15, textAlign: "center", lineHeight: 22 },
  bannedGateBtn: {
    marginTop: 32, backgroundColor: "#1a1a1a", borderRadius: 16,
    paddingHorizontal: 24, paddingVertical: 14,
  },
  bannedGateBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },

  // Banned users list (captain view)
  bannedRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#111", borderRadius: 16, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: "#1e1e1e",
  },
  bannedUsername: { color: "#888", fontSize: 14, fontWeight: "700" },
  bannedDate: { color: "#333", fontSize: 12, marginTop: 2 },
  unbanBtn: {
    backgroundColor: "rgba(239,68,68,0.1)", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.25)",
  },
  unbanBtnText: { color: "#ef4444", fontWeight: "800", fontSize: 13 },

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

  // Member action sheet (kick / ban)
  kickActionBtn: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "rgba(245,158,11,0.08)", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)", marginBottom: 10,
  },
  kickActionText: { color: "#f59e0b", fontSize: 15, fontWeight: "800" },
  kickActionSub: { color: "#8a8a8a", fontSize: 12, marginTop: 2 },
  banActionBtn: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.2)", marginBottom: 10,
  },
  banActionText: { color: "#ef4444", fontSize: 15, fontWeight: "800" },
  banActionSub: { color: "#8a8a8a", fontSize: 12, marginTop: 2 },
  memberActionCancel: {
    backgroundColor: "#0d0d0d", borderRadius: 16, paddingVertical: 15,
    alignItems: "center", marginTop: 4,
  },
  memberActionCancelText: { color: "#8a8a8a", fontWeight: "700", fontSize: 15 },
});
