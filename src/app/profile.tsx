import { Image } from "expo-image";
import { pickFromCamera, pickFromLibrary } from "../../lib/pick-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
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
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

type GameOption = { id: string; name: string; type: string; count: number };
type TournPlacement = { tournament_id: string; title: string; placement: number; proposed_date: string | null };

const PLACE_MEDALS = ["🥇", "🥈", "🥉"];

export default function ProfileScreen() {
  const { user, loading: authLoading } = useRequireAuth();

  const [username, setUsername] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [teamRole, setTeamRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Featured game
  const [featuredGameId, setFeaturedGameId] = useState<string | null>(null);
  const [availableGames, setAvailableGames] = useState<GameOption[]>([]);
  const [gamePickerVisible, setGamePickerVisible] = useState(false);
  const [savingGame, setSavingGame] = useState(false);

  // Computed stats for featured game
  const [featuredStats, setFeaturedStats] = useState<{ games: number; best: number; avg: number } | null>(null);

  // All scores with game info (for local computation)
  const [allScoreRows, setAllScoreRows] = useState<{ score: number; game_id: string | null }[]>([]);

  // Username editing
  const [editingUsername, setEditingUsername] = useState(false);
  const [draftUsername, setDraftUsername] = useState("");
  const [savingUsername, setSavingUsername] = useState(false);

  // Tournament placements
  const [tournPlacements, setTournPlacements] = useState<TournPlacement[]>([]);

  // Avatar upload
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPickerVisible, setAvatarPickerVisible] = useState(false);

  // MFA
  const [mfaEnabled, setMfaEnabled]   = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [disablingMfa, setDisablingMfa] = useState(false);

  async function loadProfile() {
    if (!user) return;
    const [profileRes, scoresRes, pendingRes, teamRes, placementsRes] = await Promise.all([
      supabase.from("profiles").select("username, avatar_url, is_admin, featured_game_id").eq("id", user.id).single(),
      supabase.from("scores").select("score, game_id, games(id, name, type)").eq("user_id", user.id).eq("status", "approved"),
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "pending"),
      supabase.from("team_members").select("role, teams(name)").eq("user_id", user.id).maybeSingle(),
      supabase.from("tournament_placements").select("placement, tournament_id, tournaments(title, proposed_date)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
    ]);

    setTournPlacements((placementsRes.data ?? []).map((p: any) => {
      const t = Array.isArray(p.tournaments) ? p.tournaments[0] : p.tournaments;
      return { tournament_id: p.tournament_id, title: t?.title ?? "Tournament", placement: p.placement, proposed_date: t?.proposed_date ?? null };
    }));

    if (profileRes.data) {
      setUsername(profileRes.data.username);
      setAvatarUrl(profileRes.data.avatar_url ?? null);
      setIsAdmin(profileRes.data.is_admin ?? false);
      setFeaturedGameId(profileRes.data.featured_game_id ?? null);
    }
    setEmail(user.email ?? null);
    setPendingCount(pendingRes.count ?? 0);

    // Build score rows and available games
    const rows = (scoresRes.data ?? []).map((s: any) => {
      const g = Array.isArray(s.games) ? s.games[0] : s.games;
      // Prefer the joined game id; fall back to the raw FK column
      const gameId: string | null = g?.id ?? s.game_id ?? null;
      return { score: s.score, game_id: gameId, game_name: g?.name ?? null, game_type: g?.type ?? null };
    });
    setAllScoreRows(rows.map((r) => ({ score: r.score, game_id: r.game_id })));

    // Build unique game list with counts — use a Map so keys are guaranteed unique
    const gameMap = new Map<string, GameOption>();
    for (const r of rows) {
      if (!r.game_id) continue;
      const existing = gameMap.get(r.game_id);
      if (existing) { existing.count++; }
      else { gameMap.set(r.game_id, { id: r.game_id, name: r.game_name ?? "Unknown", type: r.game_type ?? "", count: 1 }); }
    }
    const games = Array.from(gameMap.values()).sort((a, b) => b.count - a.count);
    setAvailableGames(games);

    // Compute stats for current featured game
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

    const uri = asset.uri;
    setUploadingAvatar(true);
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      const path = `${user.id}/avatar.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      const { error: dbError } = await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", user.id);
      if (dbError) throw dbError;

      setAvatarUrl(publicUrl);
    } catch (err: any) {
      Alert.alert("Upload failed", err.message ?? "Could not upload photo.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function saveUsername() {
    if (!user || !draftUsername.trim()) return;
    const name = draftUsername.trim();

    if (name.length < 3) { Alert.alert("Too short", "Username must be at least 3 characters."); return; }
    if (name.length > 20) { Alert.alert("Too long", "Username must be 20 characters or less."); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      Alert.alert("Invalid characters", "Only letters, numbers, and underscores are allowed.");
      return;
    }
    if (name.toLowerCase() === username?.toLowerCase()) { setEditingUsername(false); return; }

    setSavingUsername(true);

    const { data: existing } = await supabase
      .from("profiles").select("id").ilike("username", name).neq("id", user.id).maybeSingle();

    if (existing) { Alert.alert("Username taken", "That username is already in use."); setSavingUsername(false); return; }

    const { error } = await supabase.from("profiles").update({ username: name }).eq("id", user.id);
    if (error) { Alert.alert("Error", error.message); setSavingUsername(false); return; }

    setUsername(name);
    setEditingUsername(false);
    setSavingUsername(false);
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
            setMfaEnabled(false);
            setMfaFactorId(null);
          },
        },
      ]
    );
  }

  function handleLogout() {
    supabase.auth.signOut().catch(() => {});
    router.replace("/login");
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
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadProfile(); }} tintColor="#06b6d4" />
          }
        >
          {/* Hero */}
          <View style={styles.hero}>
            <Pressable style={styles.avatarWrap} onPress={() => setAvatarPickerVisible(true)} disabled={uploadingAvatar}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{initial}</Text>
                </View>
              )}
              <View style={styles.cameraChip}>
                {uploadingAvatar
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Ionicons name="camera" size={13} color="#000" />}
              </View>
            </Pressable>

            {editingUsername ? (
              <View style={styles.usernameEditRow}>
                <TextInput
                  style={styles.usernameInput}
                  value={draftUsername}
                  onChangeText={setDraftUsername}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                  returnKeyType="done"
                  onSubmitEditing={saveUsername}
                  selectTextOnFocus
                />
                {savingUsername ? (
                  <ActivityIndicator size="small" color="#06b6d4" style={{ marginLeft: 8 }} />
                ) : (
                  <>
                    <Pressable style={styles.editActionBtn} onPress={saveUsername}>
                      <Ionicons name="checkmark" size={20} color="#06b6d4" />
                    </Pressable>
                    <Pressable style={styles.editActionBtn} onPress={() => setEditingUsername(false)}>
                      <Ionicons name="close" size={20} color="#555" />
                    </Pressable>
                  </>
                )}
              </View>
            ) : (
              <Pressable
                style={styles.usernameRow}
                onPress={() => { setDraftUsername(username ?? ""); setEditingUsername(true); }}
              >
                <Text style={styles.heroName}>{username ?? "Player"}</Text>
                <Ionicons name="pencil-outline" size={14} color="#444" />
              </Pressable>
            )}

            <Text style={styles.heroEmail}>{email ?? ""}</Text>
            {teamName && (
              <View style={styles.teamPill}>
                {teamRole === "captain" && <Ionicons name="star" size={11} color="#f59e0b" />}
                <Text style={styles.teamPillText}>{teamName}</Text>
              </View>
            )}
          </View>

          {/* Featured game stats */}
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
            <View style={styles.statsRow}>
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

          {/* Pending scores notice */}
          {pendingCount > 0 && (
            <View style={styles.pendingBanner}>
              <Ionicons name="time-outline" size={16} color="#f59e0b" />
              <Text style={styles.pendingBannerText}>
                {pendingCount} score{pendingCount !== 1 ? "s" : ""} pending admin review
              </Text>
            </View>
          )}

          {/* Tournament History */}
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

          {/* Actions */}
          <Text style={styles.sectionLabel}>Quick Actions</Text>
          <View style={styles.actionsCard}>
            <ActionRow icon="qr-code-outline" label="Scan Lane QR" onPress={() => router.push("/scan-lane")} />
            <ActionRow icon="people-outline" label="Manage Teams" onPress={() => router.push("/teams")} divider />
            <ActionRow icon="podium-outline" label="Leaderboard" onPress={() => router.push("/leaderboard")} divider />
            <ActionRow icon="trophy-outline" label="Leagues" onPress={() => router.push("/leagues")} divider />
            {isAdmin && (
              <ActionRow
                icon="shield-checkmark-outline"
                label="Admin Panel"
                onPress={() => router.push("/admin" as any)}
                divider
                badge={pendingCount > 0 ? pendingCount : undefined}
              />
            )}
          </View>

          {/* Security */}
          <Text style={[styles.sectionLabel, { marginTop: 8 }]}>Security</Text>
          <View style={[styles.actionsCard, { marginBottom: 16 }]}>
            <Pressable
              style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.7 }]}
              onPress={mfaEnabled ? handleDisableMfa : () => router.push("/mfa-setup" as any)}
              disabled={disablingMfa}
            >
              <View style={[styles.actionIcon, { backgroundColor: mfaEnabled ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)" }]}>
                <Ionicons
                  name={mfaEnabled ? "shield-checkmark-outline" : "shield-outline"}
                  size={18}
                  color={mfaEnabled ? "#22c55e" : "#ef4444"}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionLabel}>Two-Factor Authentication</Text>
                <Text style={{ color: mfaEnabled ? "#22c55e" : "#555", fontSize: 11, marginTop: 1 }}>
                  {mfaEnabled ? "Enabled" : "Not enabled"}
                </Text>
              </View>
              {disablingMfa
                ? <ActivityIndicator size="small" color="#555" />
                : <Ionicons name="chevron-forward" size={16} color="#333" />
              }
            </Pressable>
          </View>

          {/* Legal */}
          <Text style={[styles.sectionLabel, { marginTop: 8 }]}>Legal</Text>
          <View style={styles.actionsCard}>
            <ActionRow icon="document-text-outline" label="Privacy Policy" onPress={() => router.push("/privacy" as any)} />
            <ActionRow icon="reader-outline" label="Terms of Service" onPress={() => router.push("/terms" as any)} divider />
            <ActionRow icon="trash-outline" label="Delete Account" onPress={() => router.push("/delete-account" as any)} divider />
          </View>

          <Pressable style={styles.logoutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={18} color="#ef4444" />
            <Text style={styles.logoutText}>Log Out</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
      <BottomTabBar />

      {/* Game picker modal */}
      <Modal visible={gamePickerVisible} transparent animationType="slide" onRequestClose={() => setGamePickerVisible(false)}>
        <View style={styles.pickerBg}>
          <Pressable style={styles.pickerDismiss} onPress={() => setGamePickerVisible(false)} />
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
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

      {/* Avatar source picker modal */}
      <Modal visible={avatarPickerVisible} transparent animationType="fade" onRequestClose={() => setAvatarPickerVisible(false)}>
        <View style={styles.pickerBg}>
          <Pressable style={styles.pickerDismiss} onPress={() => setAvatarPickerVisible(false)} />
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
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
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionRow({ icon, label, onPress, divider, badge }: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  divider?: boolean;
  badge?: number;
}) {
  return (
    <>
      {divider && <View style={styles.rowDivider} />}
      <Pressable style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.7 }]} onPress={onPress}>
        <View style={styles.actionIcon}>
          <Ionicons name={icon} size={18} color="#06b6d4" />
        </View>
        <Text style={styles.actionLabel}>{label}</Text>
        {badge != null && badge > 0 && (
          <View style={styles.actionBadge}>
            <Text style={styles.actionBadgeText}>{badge}</Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={16} color="#333" />
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  safe: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 32 },

  hero: { alignItems: "center", paddingVertical: 36, gap: 0 },

  avatarWrap: { marginBottom: 16, position: "relative" },
  avatarImg: { width: 96, height: 96, borderRadius: 48 },
  avatarFallback: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
  },
  avatarInitial: { color: "#000", fontSize: 38, fontWeight: "900" },
  cameraChip: {
    position: "absolute", bottom: 2, right: 2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
    borderWidth: 2.5, borderColor: "#0a0a0a",
  },

  usernameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  heroName: { color: "#fff", fontSize: 26, fontWeight: "900", letterSpacing: -0.4 },
  usernameEditRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  usernameInput: {
    color: "#fff", fontSize: 24, fontWeight: "900", letterSpacing: -0.4,
    borderBottomWidth: 1.5, borderBottomColor: "#06b6d4",
    paddingVertical: 2, paddingHorizontal: 2, minWidth: 100, maxWidth: 200,
  },
  editActionBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },

  heroEmail: { color: "#3a3a3a", fontSize: 13, marginBottom: 14, marginTop: 2 },
  teamPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(6,182,212,0.08)", borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.18)",
  },
  teamPillText: { color: "#06b6d4", fontWeight: "700", fontSize: 13 },

  sectionLabel: {
    color: "#3a3a3a", fontSize: 10, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 12,
  },

  // Featured game header row
  featuredHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  changeGameBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(6,182,212,0.08)", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.18)",
  },
  changeGameText: { color: "#06b6d4", fontSize: 12, fontWeight: "700" },

  statsRow: { flexDirection: "row", gap: 10, marginBottom: 22 },
  statBox: {
    flex: 1, backgroundColor: "#111", borderRadius: 18,
    padding: 16, alignItems: "center",
    borderWidth: 1, borderColor: "#1e1e1e", gap: 4,
  },
  statValue: { fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
  statLabel: { color: "#444", fontSize: 11, fontWeight: "600" },

  // No game selected state
  noGameCard: {
    backgroundColor: "#111", borderRadius: 18, borderWidth: 1, borderColor: "#1e1e1e",
    padding: 24, alignItems: "center", gap: 8, marginBottom: 22,
  },
  noGameText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  noGameSub: { color: "#444", fontSize: 12, textAlign: "center" },

  actionsCard: {
    backgroundColor: "#111", borderRadius: 18,
    borderWidth: 1, borderColor: "#1e1e1e",
    overflow: "hidden", marginBottom: 16,
  },
  actionRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 15, gap: 14 },
  actionIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: "rgba(6,182,212,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  actionLabel: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700" },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#1a1a1a", marginLeft: 64 },

  pendingBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(245,158,11,0.08)", borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)", marginBottom: 22,
  },
  pendingBannerText: { color: "#f59e0b", fontWeight: "700", fontSize: 13, flex: 1 },

  actionBadge: {
    minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: "#f59e0b", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 6, marginRight: 4,
  },
  actionBadgeText: { color: "#000", fontWeight: "900", fontSize: 12 },

  // Tournament history
  placementsCard: {
    backgroundColor: "#111", borderRadius: 18,
    borderWidth: 1, borderColor: "#1e1e1e",
    overflow: "hidden", marginBottom: 22,
  },
  placementRow:     { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  placementDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#1a1a1a", marginLeft: 52 },
  placementMedal:   { fontSize: 22, minWidth: 28, textAlign: "center" },
  placementTitle:   { color: "#fff", fontSize: 14, fontWeight: "800" },
  placementDate:    { color: "#444", fontSize: 12, marginTop: 2 },
  placementBadge:   { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: "#1a1a1a" },
  placementBadge1st:{ backgroundColor: "rgba(245,158,11,0.12)", borderWidth: 1, borderColor: "rgba(245,158,11,0.3)" },
  placementBadge2nd:{ backgroundColor: "rgba(148,163,184,0.12)", borderWidth: 1, borderColor: "rgba(148,163,184,0.3)" },
  placementBadge3rd:{ backgroundColor: "rgba(205,124,62,0.12)", borderWidth: 1, borderColor: "rgba(205,124,62,0.3)" },
  placementBadgeText:    { color: "#555", fontSize: 12, fontWeight: "800" },
  placementBadgeTextTop: { color: "#fff" },

  logoutBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "rgba(239,68,68,0.07)", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.18)",
  },
  logoutText: { color: "#ef4444", fontWeight: "800", fontSize: 15 },

  // Shared picker modal
  pickerBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  pickerDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  pickerSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36,
    borderTopWidth: 1, borderColor: "#1e1e1e", gap: 10,
    maxHeight: "75%",
  },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 4 },
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

  // Game list in picker
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
});
