import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Alert } from "../../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { RoleBadge } from "../components/role-badge";
import type { AppRole } from "../components/role-badge";
import { supabase } from "../../lib/supabase";
import { useRequireAuth } from "../hooks/use-require-auth";
import { PlayerLeagueCard } from "../components/skeeball-stats";
import { fetchPlayerInsights, fetchPlayerStats, fetchSkeeSeasons, type PlayerInsights, type PlayerStats, type SkeeSeason } from "../lib/skeeball-stats";

type UserProfile = {
  id: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  is_private: boolean;
  role: AppRole;
  featured_game_id: string | null;
};

type FriendStatus = "none" | "pending_sent" | "pending_received" | "friends";
type GameStats = { games: number; best: number; avg: number; gameName: string };
type Placement = { title: string; placement: number; proposed_date: string | null };

const MEDALS = ["🥇", "🥈", "🥉"];

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { user, loading: authLoading } = useRequireAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [friendStatus, setFriendStatus] = useState<FriendStatus>("none");
  const [friendshipId, setFriendshipId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [gameStats, setGameStats] = useState<GameStats | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [totalScores, setTotalScores] = useState(0);
  const [leagueStats, setLeagueStats] = useState<PlayerStats | null>(null);
  const [leagueInsights, setLeagueInsights] = useState<PlayerInsights | null>(null);
  const [skeeSeason, setSkeeSeason] = useState<SkeeSeason | null>(null);

  async function load() {
    if (!user || !userId) return;
    if (userId === user.id) { router.replace("/profile"); return; }

    const [profileRes, friendRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, username, avatar_url, bio, is_private, role, featured_game_id, show_skeeball_stats")
        .eq("id", userId)
        .single(),
      supabase
        .from("friendships")
        .select("id, status, requester_id")
        .or(`and(requester_id.eq.${user.id},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${user.id})`)
        .maybeSingle(),
    ]);

    if (!profileRes.data) { router.back(); return; }

    const p = profileRes.data;
    setProfile({
      id: p.id,
      username: p.username ?? "Unknown",
      avatar_url: p.avatar_url ?? null,
      bio: p.bio ?? null,
      is_private: p.is_private ?? false,
      role: (p.role ?? "user") as AppRole,
      featured_game_id: p.featured_game_id ?? null,
    });

    const fr = friendRes.data;
    if (fr) {
      setFriendshipId(fr.id);
      setFriendStatus(
        fr.status === "accepted" ? "friends" :
        fr.status === "pending" && fr.requester_id === user.id ? "pending_sent" :
        "pending_received"
      );
    }

    const canSeeStats = !p.is_private || fr?.status === "accepted";
    if (canSeeStats) {
      const [scoresRes, placRes] = await Promise.all([
        supabase.from("scores")
          .select("score, game_id, games(id, name)")
          .eq("user_id", userId).eq("status", "approved"),
        supabase.from("tournament_placements")
          .select("placement, tournaments(title, proposed_date)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }).limit(5),
      ]);

      const scores = (scoresRes.data ?? []).map((s: any) => {
        const g = Array.isArray(s.games) ? s.games[0] : s.games;
        return { score: s.score, game_id: g?.id ?? s.game_id, game_name: g?.name ?? null };
      });

      setTotalScores(scores.length);

      if (p.featured_game_id) {
        const filtered = scores.filter((s) => s.game_id === p.featured_game_id);
        if (filtered.length > 0) {
          const vals = filtered.map((s) => s.score);
          setGameStats({
            games: vals.length,
            best: Math.max(...vals),
            avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
            gameName: filtered[0].game_name ?? "Game",
          });
        }
      }

      setPlacements(
        (placRes.data ?? []).map((r: any) => {
          const t = Array.isArray(r.tournaments) ? r.tournaments[0] : r.tournaments;
          return { title: t?.title ?? "Tournament", placement: r.placement, proposed_date: t?.proposed_date ?? null };
        })
      );

      // Skee-ball league card (respects their profile display preference)
      if ((p as any).show_skeeball_stats ?? true) {
        const seasons = await fetchSkeeSeasons();
        const active = seasons.find((sn) => sn.status === "active") ?? null;
        setSkeeSeason(active);
        const [lstats, linsights] = await Promise.all([
          fetchPlayerStats(userId, active),
          fetchPlayerInsights(userId, active),
        ]);
        setLeagueStats(lstats);
        setLeagueInsights(linsights);
      }
    }

    setLoading(false);
  }

  async function sendRequest() {
    if (!user || !userId || actionLoading) return;
    setActionLoading(true);
    const { data, error } = await supabase
      .from("friendships")
      .insert({ requester_id: user.id, addressee_id: userId, status: "pending" })
      .select("id").single();
    if (!error && data) { setFriendStatus("pending_sent"); setFriendshipId(data.id); }
    else if (error) Alert.alert("Error", error.message);
    setActionLoading(false);
  }

  async function cancelRequest() {
    if (!friendshipId || actionLoading) return;
    setActionLoading(true);
    await supabase.from("friendships").delete().eq("id", friendshipId);
    setFriendStatus("none"); setFriendshipId(null);
    setActionLoading(false);
  }

  async function acceptRequest() {
    if (!friendshipId || actionLoading) return;
    setActionLoading(true);
    const { error } = await supabase.from("friendships").update({ status: "accepted" }).eq("id", friendshipId);
    if (!error) { setFriendStatus("friends"); setLoading(true); load(); }
    setActionLoading(false);
  }

  async function openMessage() {
    if (!user || !profile) return;
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .or(`and(participant_1.eq.${user.id},participant_2.eq.${profile.id}),and(participant_1.eq.${profile.id},participant_2.eq.${user.id})`)
      .maybeSingle();
    let convId: string;
    if (existing) {
      convId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from("conversations")
        .insert({ participant_1: user.id, participant_2: profile.id })
        .select("id").single();
      if (error || !created) return;
      convId = created.id;
    }
    router.push({
      pathname: "/chat-conversation" as any,
      params: { conversationId: convId, otherUserId: profile.id, otherUsername: profile.username, otherAvatarUrl: profile.avatar_url ?? "" },
    });
  }

  useEffect(() => { if (user && userId) load(); }, [user, userId]);

  if (authLoading || loading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }
  if (!profile) return null;

  const canSeeStats = !profile.is_private || friendStatus === "friends";

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/profile")}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle} numberOfLines={1}>{profile.username}</Text>
        {friendStatus === "friends" && (
          <Pressable style={s.headerAction} onPress={openMessage}>
            <Ionicons name="chatbubble-outline" size={20} color="#06b6d4" />
          </Pressable>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        {/* Hero */}
        <View style={s.hero}>
          {profile.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={s.avatar} contentFit="cover" />
          ) : (
            <View style={s.avatarFallback}>
              <Text style={s.avatarInitial}>{(profile.username[0] ?? "?").toUpperCase()}</Text>
            </View>
          )}

          <View style={s.nameRow}>
            <Text style={s.heroName}>{profile.username}</Text>
            <RoleBadge role={profile.role} size={16} />
          </View>

          {profile.bio ? <Text style={s.bio}>{profile.bio}</Text> : null}

          {/* Friend / Message button */}
          <View style={s.ctaWrap}>
            {friendStatus === "friends" ? (
              <Pressable style={s.ctaPrimary} onPress={openMessage}>
                <Ionicons name="chatbubble-outline" size={16} color="#000" />
                <Text style={s.ctaPrimaryText}>Message</Text>
              </Pressable>
            ) : friendStatus === "pending_sent" ? (
              <Pressable style={s.ctaSecondary} onPress={cancelRequest} disabled={actionLoading}>
                <Ionicons name="time-outline" size={16} color="#555" />
                <Text style={s.ctaSecondaryText}>Request Sent</Text>
              </Pressable>
            ) : friendStatus === "pending_received" ? (
              <Pressable style={[s.ctaPrimary, { backgroundColor: "#22c55e" }]} onPress={acceptRequest} disabled={actionLoading}>
                <Ionicons name="person-add-outline" size={16} color="#000" />
                <Text style={s.ctaPrimaryText}>Accept Request</Text>
              </Pressable>
            ) : (
              <Pressable style={s.ctaPrimary} onPress={sendRequest} disabled={actionLoading}>
                {actionLoading
                  ? <ActivityIndicator size="small" color="#000" />
                  : <><Ionicons name="person-add-outline" size={16} color="#000" /><Text style={s.ctaPrimaryText}>Add Friend</Text></>
                }
              </Pressable>
            )}
          </View>
        </View>

        {/* Private wall */}
        {!canSeeStats ? (
          <View style={s.privateWall}>
            <Ionicons name="lock-closed" size={36} color="#222" />
            <Text style={s.privateTitle}>This account is private</Text>
            <Text style={s.privateSub}>Add them as a friend to see their stats and scores.</Text>
          </View>
        ) : (
          <>
            <Text style={s.sectionLabel}>Stats</Text>
            <View style={s.statsRow}>
              <StatBox label="Games Played" value={totalScores.toString()} color="#06b6d4" />
              {gameStats && (
                <>
                  <StatBox label="Best Score" value={gameStats.best.toLocaleString()} color="#22c55e" />
                  <StatBox label="Avg Score" value={gameStats.avg.toLocaleString()} color="#a855f7" />
                </>
              )}
            </View>
            {gameStats && <Text style={s.featuredLabel}>Featured: {gameStats.gameName}</Text>}

            {leagueStats && leagueStats.totals.games > 0 && (
              <>
                <Text style={[s.sectionLabel, { marginTop: 22 }]}>
                  {skeeSeason ? skeeSeason.name : "Skee-Ball League"}
                </Text>
                <PlayerLeagueCard stats={leagueStats} season={skeeSeason} insights={leagueInsights} />
              </>
            )}

            {placements.length > 0 && (
              <>
                <Text style={[s.sectionLabel, { marginTop: 22 }]}>Tournament History</Text>
                <View style={s.listCard}>
                  {placements.map((p, i) => (
                    <View key={i} style={[s.listRow, i < placements.length - 1 && s.listDivider]}>
                      <Text style={s.medal}>{MEDALS[p.placement - 1] ?? `#${p.placement}`}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={s.placementTitle}>{p.title}</Text>
                        {p.proposed_date && (
                          <Text style={s.placementDate}>
                            {new Date(p.proposed_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                          </Text>
                        )}
                      </View>
                      <View style={[s.badge, p.placement === 1 && s.badge1, p.placement === 2 && s.badge2, p.placement === 3 && s.badge3]}>
                        <Text style={[s.badgeText, p.placement <= 3 && s.badgeTextTop]}>
                          {p.placement === 1 ? "1st" : p.placement === 2 ? "2nd" : p.placement === 3 ? "3rd" : `${p.placement}th`}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}

        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={s.statBox}>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 18, paddingBottom: 32 },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, color: "#fff", fontSize: 18, fontWeight: "900" },
  headerAction: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },

  hero: { alignItems: "center", paddingVertical: 32, gap: 8 },
  avatar: { width: 88, height: 88, borderRadius: 44, marginBottom: 8 },
  avatarFallback: {
    width: 88, height: 88, borderRadius: 44, marginBottom: 8,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
  },
  avatarInitial: { color: "#000", fontSize: 34, fontWeight: "900" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroName: { color: "#fff", fontSize: 24, fontWeight: "900", letterSpacing: -0.4 },
  bio: { color: "#888", fontSize: 14, textAlign: "center", lineHeight: 20, paddingHorizontal: 24, maxWidth: 360 },

  ctaWrap: { marginTop: 6 },
  ctaPrimary: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#06b6d4", borderRadius: 22, paddingHorizontal: 26, paddingVertical: 12,
  },
  ctaPrimaryText: { color: "#000", fontWeight: "900", fontSize: 15 },
  ctaSecondary: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#1a1a1a", borderRadius: 22, paddingHorizontal: 26, paddingVertical: 12,
    borderWidth: 1, borderColor: "#2a2a2a",
  },
  ctaSecondaryText: { color: "#8a8a8a", fontWeight: "700", fontSize: 15 },

  privateWall: {
    alignItems: "center", gap: 10, paddingVertical: 52,
    backgroundColor: "#0d0d0d", borderRadius: 20,
    borderWidth: 1, borderColor: "#1a1a1a", marginTop: 8,
  },
  privateTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  privateSub: { color: "#8a8a8a", fontSize: 13, textAlign: "center", paddingHorizontal: 24 },

  sectionLabel: {
    color: "#6b6b6b", fontSize: 10, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 12,
  },
  statsRow: { flexDirection: "row", gap: 10 },
  statBox: {
    flex: 1, backgroundColor: "#111", borderRadius: 18,
    padding: 16, alignItems: "center",
    borderWidth: 1, borderColor: "#1e1e1e", gap: 4,
  },
  statValue: { fontSize: 26, fontWeight: "900", letterSpacing: -0.5 },
  statLabel: { color: "#777", fontSize: 11, fontWeight: "600", textAlign: "center" },
  featuredLabel: { color: "#777", fontSize: 12, marginTop: 8, textAlign: "center" },

  listCard: { backgroundColor: "#111", borderRadius: 18, borderWidth: 1, borderColor: "#1e1e1e", overflow: "hidden" },
  listRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  listDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  medal: { fontSize: 22, minWidth: 28, textAlign: "center" },
  placementTitle: { color: "#fff", fontSize: 14, fontWeight: "800" },
  placementDate: { color: "#777", fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: "#1a1a1a" },
  badge1: { backgroundColor: "rgba(245,158,11,0.12)", borderWidth: 1, borderColor: "rgba(245,158,11,0.3)" },
  badge2: { backgroundColor: "rgba(148,163,184,0.12)", borderWidth: 1, borderColor: "rgba(148,163,184,0.3)" },
  badge3: { backgroundColor: "rgba(205,124,62,0.12)", borderWidth: 1, borderColor: "rgba(205,124,62,0.3)" },
  badgeText: { color: "#8a8a8a", fontSize: 12, fontWeight: "800" },
  badgeTextTop: { color: "#fff" },
});
