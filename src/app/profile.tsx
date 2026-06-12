import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { pickFromCamera, pickFromLibrary } from "../../lib/pick-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
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
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Alert } from "../../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomTabBar, { setTabBarAvatar } from "../components/bottom-tab-bar";
import { Avatar } from "../components/avatar";
import { RoleBadge, isElevatedRole } from "../components/role-badge";
import type { AppRole } from "../components/role-badge";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";
import { moderateText } from "../../lib/moderate-text";
import { uploadModeratedPublicImage } from "../../lib/moderated-public-media";
import { sendSecurityAlert } from "../../lib/security-notify";
import { AppTour } from "../components/app-tour";
import { useTour } from "../hooks/use-tour";
import { getTourSteps } from "../../lib/tour-steps";
import { PlayerLeagueCard } from "../components/skeeball-stats";
import { fetchPlayerStats, fetchSkeeSeasons, type PlayerStats, type SkeeSeason } from "../lib/skeeball-stats";

type GameOption = { id: string; name: string; type: string; count: number };
type TournPlacement = { tournament_id: string; title: string; placement: number; proposed_date: string | null };

const PLACE_MEDALS = ["🥇", "🥈", "🥉"];
const BIO_LIMIT = 160;

export default function ProfileScreen() {
  const { user, loading: authLoading } = useRequireAuth();

  const [username, setUsername] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<AppRole>("user");
  const isAdmin = isElevatedRole(role);
  const { tourVisible, replayTour, dismissTour } = useTour(user?.id);
  const [pendingCount, setPendingCount] = useState(0);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [teamRole, setTeamRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Header stats
  const [friendsCount, setFriendsCount] = useState(0);
  const [trophiesCount, setTrophiesCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);

  // Featured game
  const [featuredGameId, setFeaturedGameId] = useState<string | null>(null);
  const [availableGames, setAvailableGames] = useState<GameOption[]>([]);
  const [gamePickerVisible, setGamePickerVisible] = useState(false);
  const [savingGame, setSavingGame] = useState(false);
  const [featuredStats, setFeaturedStats] = useState<{ games: number; best: number; avg: number } | null>(null);
  const [allScoreRows, setAllScoreRows] = useState<{ score: number; game_id: string | null }[]>([]);

  // Bio (displayed)
  const [bio, setBio] = useState<string | null>(null);

  // Skee-ball league stats
  const [leagueStats, setLeagueStats] = useState<PlayerStats | null>(null);
  const [skeeSeason, setSkeeSeason] = useState<SkeeSeason | null>(null);
  const [showSkeeStats, setShowSkeeStats] = useState(true);
  const [savingSkeeToggle, setSavingSkeeToggle] = useState(false);

  // Tournament placements
  const [tournPlacements, setTournPlacements] = useState<TournPlacement[]>([]);

  // Edit profile sheet
  const [editVisible, setEditVisible] = useState(false);
  const [draftUsername, setDraftUsername] = useState("");
  const [draftBio, setDraftBio] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPickerVisible, setAvatarPickerVisible] = useState(false);

  // Settings sheet
  const [settingsVisible, setSettingsVisible] = useState(false);

  // MFA
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [disablingMfa, setDisablingMfa] = useState(false);

  // Privacy & status
  const [isPrivate, setIsPrivate] = useState(false);
  const [onlineStatus, setOnlineStatus] = useState<"online" | "offline">("offline");
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  // User search
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; username: string; avatar_url: string | null; role: AppRole }[]>([]);
  const [searching, setSearching] = useState(false);

  async function loadProfile() {
    if (!user) return;
    const [profileRes, scoresRes, pendingRes, teamRes, placementsRes, friendsRes, trophiesRes, convRes] = await Promise.all([
      supabase.from("profiles").select("username, avatar_url, role, featured_game_id, is_private, online_status, bio, show_skeeball_stats").eq("id", user.id).single(),
      supabase.from("scores").select("score, game_id, games(id, name, type)").eq("user_id", user.id).eq("status", "approved"),
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "pending"),
      supabase.from("team_members").select("role, teams(name)").eq("user_id", user.id).maybeSingle(),
      supabase.from("tournament_placements").select("placement, tournament_id, tournaments(title, proposed_date)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("friendships").select("id", { count: "exact", head: true }).eq("status", "accepted").or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),
      supabase.from("tournament_placements").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("conversations").select("id, last_message_at").or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`),
    ]);

    setFriendsCount(friendsRes.count ?? 0);
    setTrophiesCount(trophiesRes.count ?? 0);

    // Unread messages: same read-marker logic as the chat screen
    const convs = (convRes.data ?? []).filter((c: any) => c.last_message_at);
    if (convs.length > 0) {
      const entries = await Promise.all(
        convs.map(async (c: any) => {
          const lastRead = await AsyncStorage.getItem(`read_${c.id}`);
          return !lastRead || new Date(c.last_message_at) > new Date(lastRead);
        })
      );
      setUnreadMessages(entries.filter(Boolean).length);
    } else {
      setUnreadMessages(0);
    }

    setTournPlacements((placementsRes.data ?? []).map((p: any) => {
      const t = Array.isArray(p.tournaments) ? p.tournaments[0] : p.tournaments;
      return { tournament_id: p.tournament_id, title: t?.title ?? "Tournament", placement: p.placement, proposed_date: t?.proposed_date ?? null };
    }));

    if (profileRes.data) {
      setUsername(profileRes.data.username);
      setAvatarUrl(profileRes.data.avatar_url ?? null);
      setRole((profileRes.data.role ?? "user") as AppRole);
      setFeaturedGameId(profileRes.data.featured_game_id ?? null);
      setIsPrivate(profileRes.data.is_private ?? false);
      setOnlineStatus((profileRes.data.online_status ?? "offline") as "online" | "offline");
      setBio(profileRes.data.bio ?? null);
      setShowSkeeStats((profileRes.data as any).show_skeeball_stats ?? true);
    }

    // Skee-ball league stats, scoped to the active season when one exists
    const seasons = await fetchSkeeSeasons();
    const active = seasons.find((s) => s.status === "active") ?? null;
    setSkeeSeason(active);
    setLeagueStats(await fetchPlayerStats(user.id, active));
    setEmail(user.email ?? null);
    setPendingCount(pendingRes.count ?? 0);

    const rows = (scoresRes.data ?? []).map((s: any) => {
      const g = Array.isArray(s.games) ? s.games[0] : s.games;
      const gameId: string | null = g?.id ?? s.game_id ?? null;
      return { score: s.score, game_id: gameId, game_name: g?.name ?? null, game_type: g?.type ?? null };
    });
    setAllScoreRows(rows.map((r) => ({ score: r.score, game_id: r.game_id })));

    const gameMap = new Map<string, GameOption>();
    for (const r of rows) {
      if (!r.game_id) continue;
      const existing = gameMap.get(r.game_id);
      if (existing) { existing.count++; }
      else { gameMap.set(r.game_id, { id: r.game_id, name: r.game_name ?? "Unknown", type: r.game_type ?? "", count: 1 }); }
    }
    setAvailableGames(Array.from(gameMap.values()).sort((a, b) => b.count - a.count));

    const fid = profileRes.data?.featured_game_id ?? null;
    computeFeaturedStats(rows.map((r) => ({ score: r.score, game_id: r.game_id })), fid);

    const td = teamRes.data as any;
    if (td?.teams) {
      setTeamName(Array.isArray(td.teams) ? td.teams[0]?.name : td.teams?.name);
      setTeamRole(td.role);
    }

    setLoading(false);
    setRefreshing(false);
  }

  function computeFeaturedStats(rows: { score: number; game_id: string | null }[], gameId: string | null) {
    if (!gameId) { setFeaturedStats(null); return; }
    const filtered = rows.filter((r) => r.game_id === gameId).map((r) => r.score);
    if (filtered.length === 0) { setFeaturedStats(null); return; }
    setFeaturedStats({
      games: filtered.length,
      best: Math.max(...filtered),
      avg: Math.round(filtered.reduce((a, b) => a + b, 0) / filtered.length),
    });
  }

  async function selectFeaturedGame(gameId: string) {
    setGamePickerVisible(false);
    setSavingGame(true);
    const { error } = await supabase.from("profiles").update({ featured_game_id: gameId }).eq("id", user!.id);
    if (error) { Alert.alert("Error", error.message); setSavingGame(false); return; }
    setFeaturedGameId(gameId);
    computeFeaturedStats(allScoreRows, gameId);
    setSavingGame(false);
  }

  async function pickAvatar(source: "camera" | "library" = "camera") {
    if (!user) return;
    const asset = source === "camera"
      ? await pickFromCamera({ allowsEditing: true, aspect: [1, 1], quality: 0.8 })
      : await pickFromLibrary({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!asset) return;

    setUploadingAvatar(true);
    try {
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const path = `${user.id}/avatar.jpg`;
      const { publicUrl } = await uploadModeratedPublicImage({
        ownerId: user.id,
        data: blob,
        contentType: "image/jpeg",
        publicBucket: "avatars",
        publicPath: path,
        recordType: "avatar",
        recordId: user.id,
      });

      const { error: dbError } = await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", user.id);
      if (dbError) throw dbError;

      setAvatarUrl(publicUrl);
      setTabBarAvatar(publicUrl);
    } catch (err: any) {
      Alert.alert("Upload failed", err.message ?? "Could not upload photo.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  function openEditProfile() {
    setDraftUsername(username ?? "");
    setDraftBio(bio ?? "");
    setEditVisible(true);
  }

  async function saveProfile() {
    if (!user) return;
    const name = draftUsername.trim();
    const newBio = draftBio.trim();

    // Username validation (same rules as before)
    if (name.toLowerCase() !== (username ?? "").toLowerCase()) {
      if (name.length < 3) { Alert.alert("Too short", "Username must be at least 3 characters."); return; }
      if (name.length > 20) { Alert.alert("Too long", "Username must be 20 characters or less."); return; }
      if (!/^[a-zA-Z0-9_]+$/.test(name)) {
        Alert.alert("Invalid characters", "Only letters, numbers, and underscores are allowed.");
        return;
      }
    }

    setSavingProfile(true);

    if (name.toLowerCase() !== (username ?? "").toLowerCase()) {
      const { data: existing } = await supabase
        .from("profiles").select("id").ilike("username", name).neq("id", user.id).maybeSingle();
      if (existing) {
        Alert.alert("Username taken", "That username is already in use.");
        setSavingProfile(false);
        return;
      }
    }

    if (newBio && newBio !== (bio ?? "")) {
      const mod = await moderateText(newBio);
      if (!mod.ok) {
        Alert.alert("Bio blocked", mod.message);
        setSavingProfile(false);
        return;
      }
    }

    const { error } = await supabase
      .from("profiles")
      .update({ username: name, bio: newBio || null })
      .eq("id", user.id);

    setSavingProfile(false);
    if (error) { Alert.alert("Error", error.message); return; }

    setUsername(name);
    setBio(newBio || null);
    setEditVisible(false);
  }

  async function loadMfaStatus() {
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp?.find((f: any) => f.status === "verified");
    setMfaEnabled(!!verified);
    setMfaFactorId(verified?.id ?? null);
  }

  async function handleDisableMfa() {
    if (!mfaFactorId) return;
    Alert.alert(
      "Disable 2FA",
      "Are you sure you want to remove two-factor authentication from your account?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disable", style: "destructive",
          onPress: async () => {
            setDisablingMfa(true);
            const { error } = await supabase.auth.mfa.unenroll({ factorId: mfaFactorId });
            setDisablingMfa(false);
            if (error) { Alert.alert("Error", error.message); return; }
            sendSecurityAlert("mfa_removed");
            setMfaEnabled(false);
            setMfaFactorId(null);
          },
        },
      ]
    );
  }

  async function togglePrivacy(next: boolean) {
    if (!user || savingPrivacy) return;
    setSavingPrivacy(true);
    setIsPrivate(next);
    const { error } = await supabase.from("profiles").update({ is_private: next }).eq("id", user.id);
    if (error) setIsPrivate(!next);
    setSavingPrivacy(false);
  }

  async function toggleSkeeStats(next: boolean) {
    if (!user || savingSkeeToggle) return;
    setSavingSkeeToggle(true);
    setShowSkeeStats(next);
    const { error } = await supabase.from("profiles").update({ show_skeeball_stats: next }).eq("id", user.id);
    if (error) setShowSkeeStats(!next);
    setSavingSkeeToggle(false);
  }

  async function toggleStatus(nextOn: boolean) {
    if (!user || savingStatus) return;
    setSavingStatus(true);
    const next: "online" | "offline" = nextOn ? "online" : "offline";
    setOnlineStatus(next);
    const { error } = await supabase.from("profiles").update({ online_status: next }).eq("id", user.id);
    if (error) setOnlineStatus(nextOn ? "offline" : "online");
    setSavingStatus(false);
  }

  async function searchUsers(q: string) {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, role")
      .ilike("username", `%${q.trim()}%`)
      .neq("id", user!.id)
      .limit(15);
    setSearchResults((data ?? []).map((p: any) => ({
      id: p.id,
      username: p.username ?? "Unknown",
      avatar_url: p.avatar_url ?? null,
      role: (p.role ?? "user") as AppRole,
    })));
    setSearching(false);
  }

  function closeSearch() {
    setSearchVisible(false);
    setSearchQuery("");
    setSearchResults([]);
  }

  function handleLogout() {
    setSettingsVisible(false);
    supabase.auth.signOut().catch(() => {});
    router.replace("/login");
  }

  function navFromSettings(path: string) {
    setSettingsVisible(false);
    // Let the sheet close before pushing so the transition feels clean
    setTimeout(() => router.push(path as any), 120);
  }

  useEffect(() => { if (user) { loadProfile(); loadMfaStatus(); } }, [user]);

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  const initial = (username ?? "P")[0].toUpperCase();
  const featuredGame = availableGames.find((g) => g.id === featuredGameId);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {/* ── Top bar: @username + actions (IG style) ── */}
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            {isPrivate && <Ionicons name="lock-closed" size={14} color="#888" />}
            <Text style={styles.topBarUsername} numberOfLines={1}>{username ?? "Profile"}</Text>
            <Ionicons name="chevron-down" size={14} color="#666" />
          </View>
          <View style={styles.topBarActions}>
            <Pressable style={styles.topBarIconBtn} onPress={() => setSearchVisible(true)} hitSlop={6}>
              <Ionicons name="search-outline" size={23} color="#fff" />
            </Pressable>
            <Pressable style={styles.topBarIconBtn} onPress={() => router.push("/chat" as any)} hitSlop={6}>
              <Ionicons name="paper-plane-outline" size={23} color="#fff" />
              {unreadMessages > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{unreadMessages > 9 ? "9+" : unreadMessages}</Text>
                </View>
              )}
            </Pressable>
            <Pressable style={styles.topBarIconBtn} onPress={() => setSettingsVisible(true)} hitSlop={6}>
              <Ionicons name="menu-outline" size={26} color="#fff" />
              {pendingCount > 0 && isAdmin && <View style={styles.menuDot} />}
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadProfile(); }} tintColor="#06b6d4" />
          }
        >
          {/* ── Header: avatar + stats (IG style) ── */}
          <View style={styles.headerRow}>
            <Pressable style={styles.avatarWrap} onPress={() => setAvatarPickerVisible(true)} disabled={uploadingAvatar}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{initial}</Text>
                </View>
              )}
              {onlineStatus === "online" && <View style={styles.onlineDot} />}
              <View style={styles.cameraChip}>
                {uploadingAvatar
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Ionicons name="add" size={14} color="#000" />}
              </View>
            </Pressable>

            <View style={styles.statsRow}>
              <View style={styles.statCol}>
                <Text style={styles.statValue}>{allScoreRows.length}</Text>
                <Text style={styles.statLabel}>Scores</Text>
              </View>
              <Pressable style={styles.statCol} onPress={() => router.push("/friends" as any)}>
                <Text style={styles.statValue}>{friendsCount}</Text>
                <Text style={styles.statLabel}>Friends</Text>
              </Pressable>
              <View style={styles.statCol}>
                <Text style={styles.statValue}>{trophiesCount}</Text>
                <Text style={styles.statLabel}>Trophies</Text>
              </View>
            </View>
          </View>

          {/* ── Identity block (left-aligned, IG style) ── */}
          <View style={styles.identityBlock}>
            <View style={styles.nameRow}>
              <Text style={styles.displayName}>{username ?? "Player"}</Text>
              <RoleBadge role={role} size={15} />
            </View>
            {teamName && (
              <View style={styles.teamRow}>
                {teamRole === "captain" && <Ionicons name="star" size={11} color="#f59e0b" />}
                <Text style={styles.teamText}>{teamName}</Text>
              </View>
            )}
            {bio ? <Text style={styles.bioText}>{bio}</Text> : null}
            <Text style={styles.emailText}>{email ?? ""}</Text>
          </View>

          {/* ── Action buttons (IG style) ── */}
          <View style={styles.btnRow}>
            <Pressable style={styles.editBtn} onPress={openEditProfile}>
              <Text style={styles.editBtnText}>Edit Profile</Text>
            </Pressable>
            <Pressable style={styles.editBtn} onPress={() => router.push("/friends" as any)}>
              <Text style={styles.editBtnText}>Friends</Text>
            </Pressable>
            <Pressable style={styles.iconSquareBtn} onPress={() => router.push("/chat" as any)}>
              <Ionicons name="chatbubble-outline" size={16} color="#fff" />
            </Pressable>
          </View>

          {/* ── Pending scores notice ── */}
          {pendingCount > 0 && (
            <View style={styles.pendingBanner}>
              <Ionicons name="time-outline" size={16} color="#f59e0b" />
              <Text style={styles.pendingBannerText}>
                {pendingCount} score{pendingCount !== 1 ? "s" : ""} pending admin review
              </Text>
            </View>
          )}

          {/* ── Featured game ── */}
          <View style={styles.featuredHeader}>
            <Text style={styles.sectionLabel}>
              {featuredGame ? featuredGame.name : "Featured Game"}
            </Text>
            <Pressable
              style={styles.changeGameBtn}
              onPress={() => setGamePickerVisible(true)}
              disabled={savingGame}
            >
              {savingGame
                ? <ActivityIndicator size="small" color="#06b6d4" />
                : <>
                    <Ionicons name="swap-horizontal-outline" size={13} color="#06b6d4" />
                    <Text style={styles.changeGameText}>{featuredGame ? "Change" : "Choose Game"}</Text>
                  </>
              }
            </Pressable>
          </View>

          {featuredGame && featuredStats ? (
            <View style={styles.gameStatsRow}>
              <StatBox label="Games" value={featuredStats.games.toString()} color="#06b6d4" />
              <StatBox label="Best" value={featuredStats.best.toLocaleString()} color="#22c55e" />
              <StatBox label="Average" value={featuredStats.avg.toLocaleString()} color="#a855f7" />
            </View>
          ) : (
            <Pressable style={styles.noGameCard} onPress={() => setGamePickerVisible(true)}>
              <Ionicons name="game-controller-outline" size={24} color="#333" />
              <Text style={styles.noGameText}>Pick a game to show your stats</Text>
              <Text style={styles.noGameSub}>Visible to everyone who views your profile</Text>
            </Pressable>
          )}

          {/* ── Skee-Ball League stats ── */}
          {showSkeeStats && leagueStats && leagueStats.totals.games > 0 && (
            <View style={{ marginBottom: 22 }}>
              <Text style={styles.sectionLabel}>
                {skeeSeason ? skeeSeason.name : "Skee-Ball League"}
              </Text>
              <PlayerLeagueCard stats={leagueStats} season={skeeSeason} />
            </View>
          )}

          {/* ── Tournament History ── */}
          {tournPlacements.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Tournament History</Text>
              <View style={styles.placementsCard}>
                {tournPlacements.map((p, i) => (
                  <View key={`${p.tournament_id}-${p.placement}`} style={[styles.placementRow, i < tournPlacements.length - 1 && styles.placementDivider]}>
                    <Text style={styles.placementMedal}>{PLACE_MEDALS[p.placement - 1] ?? `#${p.placement}`}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.placementTitle}>{p.title}</Text>
                      {p.proposed_date && (
                        <Text style={styles.placementDate}>
                          {new Date(p.proposed_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                        </Text>
                      )}
                    </View>
                    <View style={[styles.placementBadge, p.placement === 1 && styles.placementBadge1st, p.placement === 2 && styles.placementBadge2nd, p.placement === 3 && styles.placementBadge3rd]}>
                      <Text style={[styles.placementBadgeText, p.placement <= 3 && styles.placementBadgeTextTop]}>
                        {p.placement === 1 ? "1st" : p.placement === 2 ? "2nd" : p.placement === 3 ? "3rd" : `${p.placement}th`}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      <BottomTabBar />

      {/* ════ Settings sheet (IG "Settings and activity") ════ */}
      <Modal visible={settingsVisible} transparent animationType="slide" onRequestClose={() => setSettingsVisible(false)}>
        <View style={styles.sheetBg}>
          <Pressable style={styles.sheetDismiss} onPress={() => setSettingsVisible(false)} />
          <View style={styles.settingsSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.settingsTitle}>Settings and activity</Text>

            <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
              {/* Account */}
              <Text style={styles.settingsGroupLabel}>Your account</Text>
              <View style={styles.settingsGroup}>
                <View style={styles.settingsRow}>
                  <View style={[styles.settingsIcon, { backgroundColor: onlineStatus === "online" ? "rgba(34,197,94,0.1)" : "rgba(85,85,85,0.1)" }]}>
                    <View style={[styles.statusDot, { backgroundColor: onlineStatus === "online" ? "#22c55e" : "#555" }]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingsRowLabel}>Availability Status</Text>
                    <Text style={styles.settingsRowSub}>{onlineStatus === "online" ? "Appearing online" : "Appearing offline"}</Text>
                  </View>
                  <Switch
                    value={onlineStatus === "online"}
                    onValueChange={toggleStatus}
                    disabled={savingStatus}
                    trackColor={{ false: "#2a2a2a", true: "rgba(34,197,94,0.5)" }}
                    thumbColor={onlineStatus === "online" ? "#22c55e" : "#666"}
                  />
                </View>
                <View style={styles.settingsDivider} />
                <View style={styles.settingsRow}>
                  <View style={[styles.settingsIcon, { backgroundColor: "rgba(168,85,247,0.1)" }]}>
                    <Ionicons name={isPrivate ? "lock-closed" : "globe-outline"} size={17} color="#a855f7" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingsRowLabel}>Private Account</Text>
                    <Text style={styles.settingsRowSub}>{isPrivate ? "Only friends can see your profile" : "Anyone can see your profile"}</Text>
                  </View>
                  <Switch
                    value={isPrivate}
                    onValueChange={togglePrivacy}
                    disabled={savingPrivacy}
                    trackColor={{ false: "#2a2a2a", true: "rgba(168,85,247,0.5)" }}
                    thumbColor={isPrivate ? "#a855f7" : "#666"}
                  />
                </View>
                <View style={styles.settingsDivider} />
                <View style={styles.settingsRow}>
                  <View style={[styles.settingsIcon, { backgroundColor: "rgba(6,182,212,0.1)" }]}>
                    <Ionicons name="bowling-ball-outline" size={17} color="#06b6d4" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingsRowLabel}>League Stats on Profile</Text>
                    <Text style={styles.settingsRowSub}>
                      {showSkeeStats ? "Visible on your profile" : "Hidden from your profile"}
                    </Text>
                  </View>
                  <Switch
                    value={showSkeeStats}
                    onValueChange={toggleSkeeStats}
                    disabled={savingSkeeToggle}
                    trackColor={{ false: "#2a2a2a", true: "rgba(6,182,212,0.5)" }}
                    thumbColor={showSkeeStats ? "#06b6d4" : "#666"}
                  />
                </View>
                <View style={styles.settingsDivider} />
                <SettingsRow
                  icon={mfaEnabled ? "shield-checkmark" : "shield-outline"}
                  iconColor={mfaEnabled ? "#22c55e" : "#ef4444"}
                  iconBg={mfaEnabled ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)"}
                  label="Two-Factor Authentication"
                  sub={mfaEnabled ? "Enabled" : "Not enabled"}
                  loading={disablingMfa}
                  onPress={() => {
                    if (mfaEnabled) { handleDisableMfa(); }
                    else { navFromSettings("/mfa-setup"); }
                  }}
                />
              </View>

              {/* Activity */}
              <Text style={styles.settingsGroupLabel}>Activity</Text>
              <View style={styles.settingsGroup}>
                <SettingsRow icon="people-circle-outline" label="Friends" onPress={() => navFromSettings("/friends")} />
                <View style={styles.settingsDivider} />
                <SettingsRow icon="paper-plane-outline" label="Messages" badge={unreadMessages} onPress={() => navFromSettings("/chat")} />
                <View style={styles.settingsDivider} />
                <SettingsRow icon="mic-outline" label="Karaoke Queue" onPress={() => navFromSettings("/karaoke")} />
                <View style={styles.settingsDivider} />
                <SettingsRow icon="podium-outline" label="Leaderboard" onPress={() => navFromSettings("/leaderboard")} />
                <View style={styles.settingsDivider} />
                <SettingsRow icon="trophy-outline" label="Leagues" onPress={() => navFromSettings("/leagues")} />
                <View style={styles.settingsDivider} />
                <SettingsRow icon="people-outline" label="Manage Teams" onPress={() => navFromSettings("/teams")} />
              </View>

              {/* Admin */}
              {(isAdmin || role === "owner" || role === "architect") && (
                <>
                  <Text style={styles.settingsGroupLabel}>Management</Text>
                  <View style={styles.settingsGroup}>
                    {isAdmin && (
                      <SettingsRow
                        icon="shield-checkmark-outline"
                        iconColor="#f59e0b"
                        iconBg="rgba(245,158,11,0.1)"
                        label="Admin Panel"
                        badge={pendingCount}
                        onPress={() => navFromSettings("/admin")}
                      />
                    )}
                    {(role === "owner" || role === "architect") && (
                      <>
                        {isAdmin && <View style={styles.settingsDivider} />}
                        <SettingsRow icon="business-outline" iconColor="#f59e0b" iconBg="rgba(245,158,11,0.1)" label="Owner Dashboard" onPress={() => navFromSettings("/owner")} />
                      </>
                    )}
                    {role === "architect" && (
                      <>
                        <View style={styles.settingsDivider} />
                        <SettingsRow icon="hardware-chip-outline" iconColor="#f59e0b" iconBg="rgba(245,158,11,0.1)" label="Architect Panel" onPress={() => navFromSettings("/architect")} />
                      </>
                    )}
                  </View>
                </>
              )}

              {/* Support & about */}
              <Text style={styles.settingsGroupLabel}>Support &amp; about</Text>
              <View style={styles.settingsGroup}>
                <SettingsRow icon="chatbox-ellipses-outline" label="Contact Support" onPress={() => navFromSettings("/support-chat")} />
                <View style={styles.settingsDivider} />
                <SettingsRow icon="star-half-outline" label="Send Feedback" onPress={() => navFromSettings("/feedback")} />
                <View style={styles.settingsDivider} />
                <SettingsRow icon="map-outline" label="How to Use This App" onPress={() => { setSettingsVisible(false); setTimeout(replayTour, 250); }} />
                <View style={styles.settingsDivider} />
                <SettingsRow icon="document-text-outline" label="Privacy Policy" onPress={() => navFromSettings("/privacy")} />
                <View style={styles.settingsDivider} />
                <SettingsRow icon="reader-outline" label="Terms of Service" onPress={() => navFromSettings("/terms")} />
              </View>

              {/* Danger zone */}
              <View style={[styles.settingsGroup, { marginTop: 20 }]}>
                <SettingsRow icon="log-out-outline" iconColor="#ef4444" iconBg="rgba(239,68,68,0.1)" label="Log Out" labelColor="#ef4444" hideChevron onPress={handleLogout} />
                <View style={styles.settingsDivider} />
                <SettingsRow icon="trash-outline" iconColor="#ef4444" iconBg="rgba(239,68,68,0.1)" label="Delete Account" labelColor="#ef4444" onPress={() => navFromSettings("/delete-account")} />
              </View>

              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ════ Edit Profile sheet (IG style) ════ */}
      <Modal visible={editVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditVisible(false)}>
        <SafeAreaView style={styles.editModal} edges={["top", "bottom"]}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.editHeader}>
              <Pressable onPress={() => setEditVisible(false)} hitSlop={8}>
                <Text style={styles.editCancelText}>Cancel</Text>
              </Pressable>
              <Text style={styles.editTitle}>Edit Profile</Text>
              <Pressable onPress={saveProfile} disabled={savingProfile} hitSlop={8}>
                {savingProfile
                  ? <ActivityIndicator size="small" color="#06b6d4" />
                  : <Text style={styles.editDoneText}>Done</Text>}
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.editScroll} keyboardShouldPersistTaps="handled">
              {/* Avatar */}
              <Pressable style={styles.editAvatarWrap} onPress={() => setAvatarPickerVisible(true)} disabled={uploadingAvatar}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.editAvatarImg} contentFit="cover" />
                ) : (
                  <View style={styles.editAvatarFallback}>
                    <Text style={styles.editAvatarInitial}>{initial}</Text>
                  </View>
                )}
                {uploadingAvatar && (
                  <View style={styles.editAvatarOverlay}>
                    <ActivityIndicator color="#fff" />
                  </View>
                )}
              </Pressable>
              <Pressable onPress={() => setAvatarPickerVisible(true)} disabled={uploadingAvatar}>
                <Text style={styles.editAvatarAction}>Edit picture</Text>
              </Pressable>

              {/* Username */}
              <View style={styles.editField}>
                <Text style={styles.editFieldLabel}>Username</Text>
                <TextInput
                  style={styles.editFieldInput}
                  value={draftUsername}
                  onChangeText={setDraftUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                  placeholder="username"
                  placeholderTextColor="#333"
                />
              </View>

              {/* Bio */}
              <View style={styles.editField}>
                <Text style={styles.editFieldLabel}>Bio</Text>
                <TextInput
                  style={[styles.editFieldInput, styles.editBioInput]}
                  value={draftBio}
                  onChangeText={setDraftBio}
                  multiline
                  maxLength={BIO_LIMIT}
                  placeholder="Write something about yourself…"
                  placeholderTextColor="#333"
                />
                <Text style={styles.editBioCount}>{draftBio.length}/{BIO_LIMIT}</Text>
              </View>

              <Text style={styles.editHint}>
                Username can contain letters, numbers, and underscores (3–20 characters).
              </Text>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ════ Game picker modal ════ */}
      <Modal visible={gamePickerVisible} transparent animationType="slide" onRequestClose={() => setGamePickerVisible(false)}>
        <View style={styles.sheetBg}>
          <Pressable style={styles.sheetDismiss} onPress={() => setGamePickerVisible(false)} />
          <View style={styles.pickerSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.pickerTitle}>Choose Featured Game</Text>
            <Text style={styles.pickerSub}>Stats for this game show on your public profile</Text>
            {availableGames.length === 0 ? (
              <View style={styles.noGamesWrap}>
                <Ionicons name="game-controller-outline" size={32} color="#333" />
                <Text style={styles.noGamesText}>No approved scores yet</Text>
                <Text style={styles.noGamesSub}>Submit and get a score approved to feature it</Text>
              </View>
            ) : (
              <ScrollView style={styles.gameList} showsVerticalScrollIndicator={false}>
                {availableGames.map((g) => (
                  <Pressable
                    key={g.id}
                    style={[styles.gameOption, g.id === featuredGameId && styles.gameOptionActive]}
                    onPress={() => selectFeaturedGame(g.id)}
                  >
                    <View style={styles.gameOptionLeft}>
                      <View style={[styles.gameTypeDot, { backgroundColor: GAME_TYPE_COLORS[g.type] ?? "#555" }]} />
                      <View>
                        <Text style={styles.gameOptionName}>{g.name}</Text>
                        <Text style={styles.gameOptionCount}>{g.count} approved score{g.count !== 1 ? "s" : ""}</Text>
                      </View>
                    </View>
                    {g.id === featuredGameId && <Ionicons name="checkmark-circle" size={20} color="#06b6d4" />}
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable style={styles.pickerCancel} onPress={() => setGamePickerVisible(false)}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ════ User search modal ════ */}
      <Modal visible={searchVisible} transparent animationType="slide" onRequestClose={closeSearch}>
        <View style={styles.sheetBg}>
          <Pressable style={styles.sheetDismiss} onPress={closeSearch} />
          <View style={[styles.pickerSheet, { maxHeight: "85%", gap: 0 }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.pickerTitle, { marginBottom: 16 }]}>Find Users</Text>
            <View style={styles.searchInputWrap}>
              <Ionicons name="search-outline" size={16} color="#444" />
              <TextInput
                style={styles.searchTextInput}
                placeholder="Search by username…"
                placeholderTextColor="#333"
                autoFocus
                autoCapitalize="none"
                value={searchQuery}
                onChangeText={searchUsers}
              />
              {searching && <ActivityIndicator size="small" color="#555" />}
            </View>
            <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {searchResults.length === 0 && searchQuery.trim() !== "" && !searching ? (
                <View style={styles.searchNoResults}>
                  <Ionicons name="person-outline" size={28} color="#222" />
                  <Text style={styles.searchNoResultsText}>No users found</Text>
                </View>
              ) : (
                searchResults.map((r) => (
                  <Pressable
                    key={r.id}
                    style={({ pressed }) => [styles.searchResultRow, pressed && { opacity: 0.7 }]}
                    onPress={() => {
                      closeSearch();
                      router.push({ pathname: "/user-profile" as any, params: { userId: r.id } });
                    }}
                  >
                    <Avatar uri={r.avatar_url} name={r.username} size={40} />
                    <Text style={[styles.searchResultName, { flex: 1 }]}>{r.username}</Text>
                    <RoleBadge role={r.role} size={14} />
                    <Ionicons name="chevron-forward" size={16} color="#333" />
                  </Pressable>
                ))
              )}
            </ScrollView>
            <Pressable style={[styles.pickerCancel, { marginTop: 10 }]} onPress={closeSearch}>
              <Text style={styles.pickerCancelText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ════ Avatar source picker modal ════ */}
      <Modal visible={avatarPickerVisible} transparent animationType="fade" onRequestClose={() => setAvatarPickerVisible(false)}>
        <View style={styles.sheetBg}>
          <Pressable style={styles.sheetDismiss} onPress={() => setAvatarPickerVisible(false)} />
          <View style={styles.pickerSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.pickerTitle}>Update Photo</Text>
            <Pressable style={styles.pickerOptionCamera} onPress={() => { setAvatarPickerVisible(false); pickAvatar("camera"); }}>
              <Ionicons name="camera" size={22} color="#000" />
              <Text style={styles.pickerOptionCameraText}>Take Photo</Text>
            </Pressable>
            <Pressable style={styles.pickerOptionLibrary} onPress={() => { setAvatarPickerVisible(false); pickAvatar("library"); }}>
              <Ionicons name="images-outline" size={22} color="#fff" />
              <Text style={styles.pickerOptionLibraryText}>Choose from Library</Text>
            </Pressable>
            <Pressable style={styles.pickerCancel} onPress={() => setAvatarPickerVisible(false)}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <AppTour
        visible={tourVisible}
        steps={getTourSteps(role)}
        onDone={dismissTour}
      />
    </View>
  );
}

const GAME_TYPE_COLORS: Record<string, string> = {
  skeeball:   "#06b6d4",
  pinball:    "#a855f7",
  arcade:     "#f59e0b",
  basketball: "#ef4444",
  airhockey:  "#22c55e",
  pool:       "#3b82f6",
};

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statBoxValue, { color }]}>{value}</Text>
      <Text style={styles.statBoxLabel}>{label}</Text>
    </View>
  );
}

function SettingsRow({ icon, label, sub, onPress, badge, iconColor = "#06b6d4", iconBg = "rgba(6,182,212,0.08)", labelColor = "#fff", loading, hideChevron }: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  sub?: string;
  onPress: () => void;
  badge?: number;
  iconColor?: string;
  iconBg?: string;
  labelColor?: string;
  loading?: boolean;
  hideChevron?: boolean;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.settingsRow, pressed && { opacity: 0.65 }]} onPress={onPress} disabled={loading}>
      <View style={[styles.settingsIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={17} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.settingsRowLabel, { color: labelColor }]}>{label}</Text>
        {sub ? <Text style={styles.settingsRowSub}>{sub}</Text> : null}
      </View>
      {badge != null && badge > 0 && (
        <View style={styles.settingsBadge}>
          <Text style={styles.settingsBadgeText}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      )}
      {loading
        ? <ActivityIndicator size="small" color="#555" />
        : !hideChevron && <Ionicons name="chevron-forward" size={15} color="#333" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  safe: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 32 },

  // ── Top bar ──
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingVertical: 8,
  },
  topBarLeft: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, marginRight: 12 },
  topBarUsername: { color: "#fff", fontSize: 21, fontWeight: "900", letterSpacing: -0.3, flexShrink: 1 },
  topBarActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  topBarIconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  unreadBadge: {
    position: "absolute", top: 4, right: 2,
    minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#0a0a0a",
  },
  unreadBadgeText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  menuDot: {
    position: "absolute", top: 8, right: 7,
    width: 8, height: 8, borderRadius: 4, backgroundColor: "#f59e0b",
    borderWidth: 1.5, borderColor: "#0a0a0a",
  },

  // ── Header: avatar + stats ──
  headerRow: { flexDirection: "row", alignItems: "center", paddingTop: 12, paddingBottom: 4 },
  avatarWrap: { position: "relative", marginRight: 8 },
  avatarImg: { width: 86, height: 86, borderRadius: 43 },
  avatarFallback: {
    width: 86, height: 86, borderRadius: 43,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
  },
  avatarInitial: { color: "#000", fontSize: 34, fontWeight: "900" },
  onlineDot: {
    position: "absolute", top: 4, right: 4,
    width: 14, height: 14, borderRadius: 7, backgroundColor: "#22c55e",
    borderWidth: 2.5, borderColor: "#0a0a0a",
  },
  cameraChip: {
    position: "absolute", bottom: 0, right: 0,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
    borderWidth: 2.5, borderColor: "#0a0a0a",
  },

  statsRow: { flex: 1, flexDirection: "row", justifyContent: "space-evenly" },
  statCol: { alignItems: "center", minWidth: 64 },
  statValue: { color: "#fff", fontSize: 19, fontWeight: "900", letterSpacing: -0.3 },
  statLabel: { color: "#888", fontSize: 12, fontWeight: "500", marginTop: 1 },

  // ── Identity ──
  identityBlock: { paddingTop: 12, paddingBottom: 4, gap: 3 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  displayName: { color: "#fff", fontSize: 15, fontWeight: "800" },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  teamText: { color: "#06b6d4", fontSize: 13, fontWeight: "700" },
  bioText: { color: "#ccc", fontSize: 13.5, lineHeight: 19, marginTop: 1 },
  emailText: { color: "#3a3a3a", fontSize: 12, marginTop: 1 },

  // ── Action buttons ──
  btnRow: { flexDirection: "row", gap: 7, marginTop: 14, marginBottom: 20 },
  editBtn: {
    flex: 1, backgroundColor: "#1a1a1a", borderRadius: 10,
    paddingVertical: 9, alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#2a2a2a",
  },
  editBtnText: { color: "#fff", fontSize: 13.5, fontWeight: "700" },
  iconSquareBtn: {
    width: 38, backgroundColor: "#1a1a1a", borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth, borderColor: "#2a2a2a",
  },

  sectionLabel: {
    color: "#3a3a3a", fontSize: 10, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 12,
  },

  // ── Featured game ──
  featuredHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  changeGameBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(6,182,212,0.08)", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.18)",
  },
  changeGameText: { color: "#06b6d4", fontSize: 12, fontWeight: "700" },

  gameStatsRow: { flexDirection: "row", gap: 10, marginBottom: 22 },
  statBox: {
    flex: 1, backgroundColor: "#111", borderRadius: 18,
    padding: 16, alignItems: "center",
    borderWidth: 1, borderColor: "#1e1e1e", gap: 4,
  },
  statBoxValue: { fontSize: 26, fontWeight: "900", letterSpacing: -0.5 },
  statBoxLabel: { color: "#444", fontSize: 11, fontWeight: "600" },

  noGameCard: {
    backgroundColor: "#111", borderRadius: 18, borderWidth: 1, borderColor: "#1e1e1e",
    padding: 24, alignItems: "center", gap: 8, marginBottom: 22,
  },
  noGameText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  noGameSub: { color: "#444", fontSize: 12, textAlign: "center" },

  pendingBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(245,158,11,0.08)", borderRadius: 14, padding: 13,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)", marginBottom: 20,
  },
  pendingBannerText: { color: "#f59e0b", fontWeight: "700", fontSize: 13, flex: 1 },

  // ── Tournament history ──
  placementsCard: {
    backgroundColor: "#111", borderRadius: 18,
    borderWidth: 1, borderColor: "#1e1e1e",
    overflow: "hidden", marginBottom: 22,
  },
  placementRow:     { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  placementDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  placementMedal:   { fontSize: 22, minWidth: 28, textAlign: "center" },
  placementTitle:   { color: "#fff", fontSize: 14, fontWeight: "800" },
  placementDate:    { color: "#444", fontSize: 12, marginTop: 2 },
  placementBadge:   { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: "#1a1a1a" },
  placementBadge1st:{ backgroundColor: "rgba(245,158,11,0.12)", borderWidth: 1, borderColor: "rgba(245,158,11,0.3)" },
  placementBadge2nd:{ backgroundColor: "rgba(148,163,184,0.12)", borderWidth: 1, borderColor: "rgba(148,163,184,0.3)" },
  placementBadge3rd:{ backgroundColor: "rgba(205,124,62,0.12)", borderWidth: 1, borderColor: "rgba(205,124,62,0.3)" },
  placementBadgeText:    { color: "#555", fontSize: 12, fontWeight: "800" },
  placementBadgeTextTop: { color: "#fff" },

  // ── Shared bottom sheets ──
  sheetBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  sheetDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 12 },

  // ── Settings sheet ──
  settingsSheet: {
    backgroundColor: "#0d0d0d", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12,
    borderTopWidth: 1, borderColor: "#1e1e1e",
    maxHeight: "88%",
  },
  settingsTitle: { color: "#fff", fontSize: 17, fontWeight: "900", textAlign: "center", marginBottom: 16 },
  settingsGroupLabel: {
    color: "#3a3a3a", fontSize: 10, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.4,
    marginBottom: 8, marginTop: 14, paddingHorizontal: 4,
  },
  settingsGroup: {
    backgroundColor: "#141414", borderRadius: 16,
    borderWidth: 1, borderColor: "#1e1e1e", overflow: "hidden",
  },
  settingsRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  settingsIcon: {
    width: 32, height: 32, borderRadius: 9,
    alignItems: "center", justifyContent: "center",
  },
  settingsRowLabel: { color: "#fff", fontSize: 14.5, fontWeight: "600" },
  settingsRowSub: { color: "#555", fontSize: 11.5, marginTop: 1 },
  settingsDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#1e1e1e", marginLeft: 58 },
  settingsBadge: {
    minWidth: 21, height: 21, borderRadius: 11, paddingHorizontal: 6,
    backgroundColor: "#f59e0b", alignItems: "center", justifyContent: "center",
  },
  settingsBadgeText: { color: "#000", fontWeight: "900", fontSize: 11 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },

  // ── Edit profile sheet ──
  editModal: { flex: 1, backgroundColor: "#0a0a0a" },
  editHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  editCancelText: { color: "#888", fontSize: 15, fontWeight: "600" },
  editTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },
  editDoneText: { color: "#06b6d4", fontSize: 15, fontWeight: "800" },
  editScroll: { padding: 20, alignItems: "center" },
  editAvatarWrap: { position: "relative", marginBottom: 10 },
  editAvatarImg: { width: 92, height: 92, borderRadius: 46 },
  editAvatarFallback: {
    width: 92, height: 92, borderRadius: 46,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
  },
  editAvatarInitial: { color: "#000", fontSize: 36, fontWeight: "900" },
  editAvatarOverlay: {
    ...StyleSheet.absoluteFillObject, borderRadius: 46,
    backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center",
  },
  editAvatarAction: { color: "#06b6d4", fontSize: 14, fontWeight: "800", marginBottom: 24 },
  editField: { width: "100%", marginBottom: 18 },
  editFieldLabel: { color: "#666", fontSize: 12, fontWeight: "700", marginBottom: 7, textTransform: "uppercase", letterSpacing: 0.6 },
  editFieldInput: {
    backgroundColor: "#111", borderRadius: 14, borderWidth: 1, borderColor: "#1e1e1e",
    color: "#fff", fontSize: 15, paddingHorizontal: 16, paddingVertical: 13,
  },
  editBioInput: { minHeight: 88, maxHeight: 130, textAlignVertical: "top", paddingTop: 13 },
  editBioCount: { color: "#333", fontSize: 11, textAlign: "right", marginTop: 5 },
  editHint: { color: "#3a3a3a", fontSize: 12, textAlign: "center", lineHeight: 17, paddingHorizontal: 12 },

  // ── Picker sheets (game / search / avatar) ──
  pickerSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36,
    borderTopWidth: 1, borderColor: "#1e1e1e", gap: 10,
    maxHeight: "75%",
  },
  pickerTitle: { color: "#fff", fontSize: 16, fontWeight: "900", textAlign: "center" },
  pickerSub: { color: "#444", fontSize: 12, textAlign: "center", marginBottom: 4 },
  pickerOptionCamera: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#06b6d4", borderRadius: 16, padding: 16,
  },
  pickerOptionCameraText: { color: "#000", fontWeight: "900", fontSize: 16 },
  pickerOptionLibrary: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#1a1a1a", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "#2a2a2a",
  },
  pickerOptionLibraryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  pickerCancel: { backgroundColor: "#0d0d0d", borderRadius: 16, padding: 16, alignItems: "center", marginTop: 4 },
  pickerCancelText: { color: "#555", fontWeight: "700", fontSize: 15 },

  gameList: { maxHeight: 320 },
  gameOption: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 14, borderRadius: 14, marginBottom: 6,
    backgroundColor: "#0d0d0d", borderWidth: 1, borderColor: "#1a1a1a",
  },
  gameOptionActive: { borderColor: "#06b6d4", backgroundColor: "rgba(6,182,212,0.06)" },
  gameOptionLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  gameTypeDot: { width: 10, height: 10, borderRadius: 5 },
  gameOptionName: { color: "#fff", fontWeight: "800", fontSize: 14 },
  gameOptionCount: { color: "#444", fontSize: 11, marginTop: 2 },

  noGamesWrap: { alignItems: "center", gap: 8, paddingVertical: 24 },
  noGamesText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  noGamesSub: { color: "#444", fontSize: 12, textAlign: "center" },

  searchInputWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#0a0a0a", borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 12,
  },
  searchTextInput: { flex: 1, color: "#fff", fontSize: 15 },
  searchResultRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  searchResultName: { color: "#fff", fontSize: 15, fontWeight: "700" },
  searchNoResults: { alignItems: "center", gap: 8, paddingVertical: 32 },
  searchNoResultsText: { color: "#444", fontSize: 14 },
});
