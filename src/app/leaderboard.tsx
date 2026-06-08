import { FlashList } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
} from "react-native-reanimated";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomTabBar from "../components/bottom-tab-bar";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

type LeaderEntry = {
  rank: number;
  user_id: string;
  username: string;
  game_name: string;
  game_type: string;
  score: number;
  created_at: string;
};
type TimeFilter = "alltime" | "season";
type GameOption = { id: string; name: string; type: string };
type ShareFriend = { id: string; username: string; avatar_url: string | null };

const GAME_TYPE_COLORS: Record<string, string> = {
  skeeball:   "#06b6d4",
  pinball:    "#a855f7",
  arcade:     "#f59e0b",
  basketball: "#ef4444",
  airhockey:  "#22c55e",
  pool:       "#3b82f6",
};

export default function LeaderboardScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [entries, setEntries] = useState<LeaderEntry[]>([]);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("alltime");
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedGameName, setSelectedGameName] = useState<string | null>(null);
  const [games, setGames] = useState<GameOption[]>([]);
  const [gamePickerVisible, setGamePickerVisible] = useState(false);
  const [gameSearch, setGameSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [myScore, setMyScore] = useState<number | null>(null);

  const [shareEntry, setShareEntry] = useState<LeaderEntry | null>(null);
  const [shareFriends, setShareFriends] = useState<ShareFriend[]>([]);
  const [shareFriendsLoading, setShareFriendsLoading] = useState(false);
  const [shareFriendSearch, setShareFriendSearch] = useState("");
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());

  async function loadGames() {
    const { data } = await supabase.from("games").select("id, name, type").order("name");
    const seen = new Set<string>();
    const unique = (data ?? []).filter((g: GameOption) => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });
    setGames(unique);
  }

  async function loadLeaderboard(tf: TimeFilter, gameId: string | null) {
    if (!user) return;
    let query = supabase
      .from("scores")
      .select("user_id, score, created_at, game_id, games(name, type)")
      .eq("status", "approved")
      .order("score", { ascending: false })
      .limit(50);

    if (tf === "season") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      query = query.gte("created_at", cutoff.toISOString());
    }
    if (gameId) query = query.eq("game_id", gameId);

    const { data } = await query;

    // Fetch display names from public_profiles (respects is_private flag).
    // Private users show as "Unknown" on the leaderboard.
    const userIds = [...new Set((data ?? []).map((r: any) => r.user_id as string))];
    let usernameMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: pubProfiles } = await supabase
        .from("public_profiles")
        .select("id, username")
        .in("id", userIds);
      for (const p of pubProfiles ?? []) usernameMap[p.id] = p.username ?? "Unknown";
    }

    const mapped: LeaderEntry[] = (data ?? []).map((row: any, i: number) => ({
      rank: i + 1,
      user_id: row.user_id,
      username: usernameMap[row.user_id] ?? "Unknown",
      game_name: Array.isArray(row.games) ? (row.games[0]?.name ?? "Game") : (row.games?.name ?? "Game"),
      game_type: Array.isArray(row.games) ? (row.games[0]?.type ?? "") : (row.games?.type ?? ""),
      score: row.score,
      created_at: row.created_at,
    }));

    setEntries(mapped);
    const myPos = mapped.findIndex((e) => e.user_id === user.id);
    setMyRank(myPos >= 0 ? myPos + 1 : null);
    setMyScore(myPos >= 0 ? mapped[myPos].score : null);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (user) {
      loadGames();
      loadLeaderboard(timeFilter, selectedGameId);
    }
  }, [user]);

  async function switchTimeFilter(tf: TimeFilter) {
    setTimeFilter(tf);
    setLoading(true);
    await loadLeaderboard(tf, selectedGameId);
  }

  async function selectGame(game: GameOption | null) {
    setGamePickerVisible(false);
    setGameSearch("");
    setSelectedGameId(game?.id ?? null);
    setSelectedGameName(game?.name ?? null);
    setLoading(true);
    await loadLeaderboard(timeFilter, game?.id ?? null);
  }

  const filteredGames = games.filter((g) =>
    g.name.toLowerCase().includes(gameSearch.toLowerCase())
  );

  async function openShareModal(entry: LeaderEntry) {
    setShareEntry(entry);
    setSentTo(new Set());
    setShareFriendSearch("");
    setShareFriendsLoading(true);
    if (!user) return;
    const { data: fs } = await supabase
      .from("friendships")
      .select("requester_id, addressee_id")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .eq("status", "accepted");
    const ids = (fs ?? []).map((f: any) =>
      f.requester_id === user.id ? f.addressee_id : f.requester_id
    );
    if (ids.length) {
      const { data: profiles } = await supabase
        .from("public_profiles")
        .select("id, username, avatar_url")
        .in("id", ids);
      setShareFriends((profiles ?? []).map((p: any) => ({
        id: p.id,
        username: p.username ?? "Unknown",
        avatar_url: p.avatar_url ?? null,
      })));
    } else {
      setShareFriends([]);
    }
    setShareFriendsLoading(false);
  }

  async function sendScoreDM(friend: ShareFriend) {
    if (!user || !shareEntry || sendingTo) return;
    setSendingTo(friend.id);

    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .or(`and(participant_1.eq.${user.id},participant_2.eq.${friend.id}),and(participant_1.eq.${friend.id},participant_2.eq.${user.id})`)
      .maybeSingle();

    let convId: string;
    if (existing) {
      convId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from("conversations")
        .insert({ participant_1: user.id, participant_2: friend.id })
        .select("id").single();
      if (error || !created) { setSendingTo(null); return; }
      convId = created.id;
    }

    const content = `🏆 Check out my leaderboard score!\n#${shareEntry.rank} · ${shareEntry.score.toLocaleString()} pts\n${shareEntry.game_name}`;
    await supabase.from("messages").insert({ conversation_id: convId, sender_id: user.id, content });
    await supabase.from("conversations").update({
      last_message: `🏆 Shared a score`,
      last_message_at: new Date().toISOString(),
    }).eq("id", convId);

    setSendingTo(null);
    setSentTo((prev) => new Set([...prev, friend.id]));
  }

  async function shareScore(entry: LeaderEntry) {
    const msg = `I ranked #${entry.rank} on the ${entry.game_name} leaderboard with ${entry.score.toLocaleString()} pts! 🎯`;
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && (navigator as any).share) {
        await (navigator as any).share({ title: "My Arcade Score", text: msg });
      } else {
        await Share.share({ message: msg });
      }
    } catch {}
  }

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);

  const listHeader = (
    <>
      {/* Page header */}
      <View style={styles.pageHeaderRow}>
        <View>
          <Text style={styles.pageTitle}>Leaderboard</Text>
          <Text style={styles.pageSub}>Top scores across the arcade</Text>
        </View>
        <View style={styles.podiumIcon}>
          <Ionicons name="podium" size={22} color="#f59e0b" />
        </View>
      </View>

      {/* Time filter */}
      <View style={styles.filterRow}>
        {(["alltime", "season"] as TimeFilter[]).map((tf) => (
          <Pressable
            key={tf}
            style={[styles.filterBtn, timeFilter === tf && styles.filterBtnActive]}
            onPress={() => switchTimeFilter(tf)}
          >
            <Text style={[styles.filterText, timeFilter === tf && styles.filterTextActive]}>
              {tf === "alltime" ? "All Time" : "This Season"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Game selector */}
      <Pressable style={styles.gameSelector} onPress={() => setGamePickerVisible(true)}>
        {selectedGameId ? (
          <View style={styles.gameSelectorLeft}>
            <View style={[styles.gameDot, { backgroundColor: GAME_TYPE_COLORS[games.find(g => g.id === selectedGameId)?.type ?? ""] ?? "#555" }]} />
            <Text style={styles.gameSelectorText}>{selectedGameName}</Text>
          </View>
        ) : (
          <View style={styles.gameSelectorLeft}>
            <Ionicons name="game-controller-outline" size={16} color="#555" />
            <Text style={styles.gameSelectorPlaceholder}>All Games</Text>
          </View>
        )}
        <Ionicons name="chevron-down" size={16} color="#444" />
      </Pressable>

      {/* My rank */}
      {myRank && (
        <View style={styles.myRankCard}>
          <View>
            <Text style={styles.myRankLabel}>YOUR RANK</Text>
            <Text style={styles.myRankValue}>#{myRank}</Text>
          </View>
          <View style={styles.myRankDivider} />
          {myScore && (
            <View>
              <Text style={styles.myScoreLabel}>YOUR BEST</Text>
              <Text style={styles.myScoreValue}>{myScore.toLocaleString()}</Text>
            </View>
          )}
        </View>
      )}

      {entries.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="podium-outline" size={32} color="#333" />
          </View>
          <Text style={styles.emptyTitle}>No scores yet</Text>
          <Text style={styles.emptySub}>
            {selectedGameId ? `No approved ${selectedGameName} scores found.` : "Be the first to submit a score!"}
          </Text>
        </View>
      ) : (
        <>
          {top3.length > 0 && (
            <View style={styles.podium}>
              {[top3.find((e) => e.rank === 2), top3.find((e) => e.rank === 1), top3.find((e) => e.rank === 3)]
                .filter(Boolean)
                .map((entry, i) => (
                  <PodiumCard
                    key={entry!.rank}
                    entry={entry!}
                    isMe={entry!.user_id === user?.id}
                    delay={i * 80}
                    onShare={() => openShareModal(entry!)}
                  />
                ))}
            </View>
          )}
          {rest.length > 0 && (
            <View style={styles.listCard}>
              <View style={styles.listHeader}>
                <Text style={styles.listHeaderText}>RANKINGS</Text>
              </View>
            </View>
          )}
        </>
      )}
    </>
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {rest.length > 0 ? (
          <FlashList
            data={rest}
            keyExtractor={(item) => `${item.user_id}-${item.created_at}`}
            ListHeaderComponent={listHeader}
            renderItem={({ item, index }) => (
              <RankRow
                entry={item}
                isLast={index === rest.length - 1}
                isMe={item.user_id === user?.id}
                onShare={() => openShareModal(item)}
              />
            )}
            contentContainerStyle={styles.flashContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); loadLeaderboard(timeFilter, selectedGameId); }}
                tintColor="#06b6d4"
              />
            }
          />
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); loadLeaderboard(timeFilter, selectedGameId); }}
                tintColor="#06b6d4"
              />
            }
          >
            {listHeader}
          </ScrollView>
        )}
      </SafeAreaView>
      <BottomTabBar />

      {/* Score share modal */}
      <Modal visible={!!shareEntry} transparent animationType="slide" onRequestClose={() => setShareEntry(null)}>
        <Pressable style={styles.pickerBg} onPress={() => setShareEntry(null)}>
          <Pressable style={styles.shareSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.pickerHandle} />
            <View style={styles.shareScorePreview}>
              <Text style={styles.shareScoreRank}>#{shareEntry?.rank}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.shareScoreVal}>{shareEntry?.score.toLocaleString()} pts</Text>
                <Text style={styles.shareScoreGame}>{shareEntry?.game_name}</Text>
              </View>
            </View>
            <Text style={styles.shareSectionLabel}>Send to a Friend</Text>
            <View style={styles.shareFriendSearch}>
              <Ionicons name="search-outline" size={14} color="#444" />
              <TextInput
                style={styles.shareFriendSearchInput}
                placeholder="Search friends…"
                placeholderTextColor="#333"
                value={shareFriendSearch}
                onChangeText={setShareFriendSearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {shareFriendsLoading ? (
              <ActivityIndicator color="#06b6d4" style={{ marginVertical: 20 }} />
            ) : shareFriends.length === 0 ? (
              <View style={styles.shareNoFriends}>
                <Ionicons name="people-outline" size={28} color="#2a2a2a" />
                <Text style={styles.shareNoFriendsText}>No friends yet — add some from Leaderboard profiles</Text>
              </View>
            ) : (
              <ScrollView style={styles.shareFriendList} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {shareFriends
                  .filter((f) => f.username.toLowerCase().includes(shareFriendSearch.toLowerCase()))
                  .map((friend) => {
                    const sent = sentTo.has(friend.id);
                    const sending = sendingTo === friend.id;
                    return (
                      <Pressable
                        key={friend.id}
                        style={[styles.shareFriendRow, sent && styles.shareFriendRowSent]}
                        onPress={() => !sent && sendScoreDM(friend)}
                        disabled={sending || sent}
                      >
                        <View style={styles.shareFriendAvatar}>
                          <Text style={styles.shareFriendAvatarText}>{friend.username[0].toUpperCase()}</Text>
                        </View>
                        <Text style={styles.shareFriendName} numberOfLines={1}>{friend.username}</Text>
                        {sending ? (
                          <ActivityIndicator size="small" color="#06b6d4" />
                        ) : sent ? (
                          <View style={styles.shareSentBadge}>
                            <Ionicons name="checkmark" size={13} color="#22c55e" />
                            <Text style={styles.shareSentText}>Sent</Text>
                          </View>
                        ) : (
                          <View style={styles.shareSendBtn}>
                            <Ionicons name="paper-plane-outline" size={14} color="#000" />
                            <Text style={styles.shareSendBtnText}>Send</Text>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
              </ScrollView>
            )}
            <Pressable style={styles.shareExternalBtn} onPress={() => shareEntry && shareScore(shareEntry)}>
              <Ionicons name="link-outline" size={16} color="#888" />
              <Text style={styles.shareExternalBtnText}>Share as Link</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Game picker modal */}
      <Modal visible={gamePickerVisible} transparent animationType="slide" onRequestClose={() => { setGamePickerVisible(false); setGameSearch(""); }}>
        <View style={styles.pickerBg}>
          <Pressable style={styles.pickerDismiss} onPress={() => { setGamePickerVisible(false); setGameSearch(""); }} />
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Select Game</Text>
            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={16} color="#444" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search games..."
                placeholderTextColor="#333"
                value={gameSearch}
                onChangeText={setGameSearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {gameSearch.length > 0 && (
                <Pressable onPress={() => setGameSearch("")}>
                  <Ionicons name="close-circle" size={16} color="#444" />
                </Pressable>
              )}
            </View>
            <ScrollView style={styles.gameList} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Pressable
                style={[styles.gameOption, !selectedGameId && styles.gameOptionActive]}
                onPress={() => selectGame(null)}
              >
                <View style={styles.gameOptionLeft}>
                  <Ionicons name="game-controller-outline" size={16} color={!selectedGameId ? "#06b6d4" : "#555"} />
                  <Text style={[styles.gameOptionName, !selectedGameId && styles.gameOptionNameActive]}>All Games</Text>
                </View>
                {!selectedGameId && <Ionicons name="checkmark-circle" size={20} color="#06b6d4" />}
              </Pressable>
              {filteredGames.length === 0 && gameSearch.length > 0 ? (
                <View style={styles.noResults}>
                  <Text style={styles.noResultsText}>No games match "{gameSearch}"</Text>
                </View>
              ) : (
                filteredGames.map((g) => (
                  <Pressable
                    key={g.id}
                    style={[styles.gameOption, g.id === selectedGameId && styles.gameOptionActive]}
                    onPress={() => selectGame(g)}
                  >
                    <View style={styles.gameOptionLeft}>
                      <View style={[styles.gameDot, { backgroundColor: GAME_TYPE_COLORS[g.type] ?? "#555" }]} />
                      <Text style={[styles.gameOptionName, g.id === selectedGameId && styles.gameOptionNameActive]}>{g.name}</Text>
                    </View>
                    {g.id === selectedGameId && <Ionicons name="checkmark-circle" size={20} color="#06b6d4" />}
                  </Pressable>
                ))
              )}
            </ScrollView>
            <Pressable style={styles.pickerCancel} onPress={() => { setGamePickerVisible(false); setGameSearch(""); }}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function RankRow({ entry, isLast, isMe, onShare }: { entry: LeaderEntry; isLast: boolean; isMe: boolean; onShare: () => void }) {
  const typeColor = GAME_TYPE_COLORS[entry.game_type] ?? "#333";
  return (
    <View style={[styles.listRowWrap, !isLast && styles.listRowBorder]}>
      <Text style={styles.listRank}>#{entry.rank}</Text>
      <View style={[styles.listTypeDot, { backgroundColor: typeColor }]} />
      <View style={styles.listInfo}>
        <Text style={styles.listUsername}>
          {entry.username}
          {isMe ? <Text style={styles.listYou}> · you</Text> : ""}
        </Text>
        <Text style={styles.listGame}>{entry.game_name}</Text>
      </View>
      <Text style={styles.listScore}>{entry.score.toLocaleString()}</Text>
      {isMe && (
        <Pressable style={styles.listShareBtn} onPress={onShare}>
          <Ionicons name="share-outline" size={16} color="#06b6d4" />
        </Pressable>
      )}
    </View>
  );
}

function PodiumCard({ entry, isMe, delay, onShare }: { entry: LeaderEntry; isMe: boolean; delay: number; onShare: () => void }) {
  const isFirst = entry.rank === 1;
  const medals = ["🥇", "🥈", "🥉"];
  const accents = ["#f59e0b", "#94a3b8", "#b45309"];
  const accent = accents[entry.rank - 1] ?? "#555";
  const avatarSize = isFirst ? 72 : 58;

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    opacity.value = withDelay(delay, withSpring(1, { damping: 18, stiffness: 160 }));
    translateY.value = withDelay(delay, withSpring(0, { damping: 18, stiffness: 160 }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[
      styles.podiumCard,
      isMe && styles.podiumCardMe,
      isFirst && styles.podiumCardFirst,
      { flex: isFirst ? 1.2 : 1 },
      animStyle,
    ]}>
      {isFirst && <View style={styles.crownRow}><Text style={styles.crownText}>👑</Text></View>}
      <Text style={styles.podiumMedal}>{medals[entry.rank - 1]}</Text>
      <View style={[
        styles.podiumAvatar,
        { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, borderColor: accent },
        isFirst && { shadowColor: accent, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
      ]}>
        <Text style={[styles.podiumAvatarText, { fontSize: avatarSize * 0.38 }]}>{entry.username[0].toUpperCase()}</Text>
      </View>
      <Text style={styles.podiumUsername} numberOfLines={1}>{entry.username}</Text>
      <Text style={[styles.podiumScore, { color: accent }]}>{entry.score.toLocaleString()}</Text>
      <Text style={styles.podiumGame} numberOfLines={1}>{entry.game_name}</Text>
      {isMe && (
        <Pressable style={styles.shareBtn} onPress={onShare}>
          <Ionicons name="share-outline" size={14} color="#06b6d4" />
          <Text style={styles.shareBtnText}>Share</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  safe: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28 },
  flashContent: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28 },

  pageHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 },
  pageTitle: { color: "#fff", fontSize: 32, fontWeight: "900", letterSpacing: -0.5, marginBottom: 4 },
  pageSub: { color: "#555", fontSize: 14 },
  podiumIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "rgba(245,158,11,0.1)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
  },

  filterRow: {
    flexDirection: "row", backgroundColor: "#141414", borderRadius: 14,
    padding: 4, gap: 4, marginBottom: 12, borderWidth: 1, borderColor: "#222",
  },
  filterBtn: { flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: "center" },
  filterBtnActive: { backgroundColor: "#1e1e1e" },
  filterText: { color: "#505050", fontWeight: "600", fontSize: 13 },
  filterTextActive: { color: "#fff", fontWeight: "800" },

  gameSelector: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#111", borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: "#222", marginBottom: 20,
  },
  gameSelectorLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  gameDot: { width: 10, height: 10, borderRadius: 5 },
  gameSelectorText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  gameSelectorPlaceholder: { color: "#444", fontWeight: "600", fontSize: 14 },

  myRankCard: {
    backgroundColor: "rgba(6,182,212,0.06)", borderRadius: 18, padding: 18,
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderColor: "rgba(6,182,212,0.2)", marginBottom: 24, gap: 20,
  },
  myRankLabel: { color: "#06b6d4", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 4 },
  myRankValue: { color: "#fff", fontSize: 32, fontWeight: "900", letterSpacing: -1 },
  myRankDivider: { width: 1, height: 40, backgroundColor: "rgba(6,182,212,0.2)" },
  myScoreLabel: { color: "#444", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 4 },
  myScoreValue: { color: "#22c55e", fontSize: 24, fontWeight: "900" },

  emptyCard: { backgroundColor: "#111", borderRadius: 22, padding: 40, alignItems: "center", borderWidth: 1, borderColor: "#1e1e1e", gap: 10 },
  emptyIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#161616", borderWidth: 1, borderColor: "#222", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  emptySub: { color: "#555", fontSize: 14, textAlign: "center" },

  podium: { flexDirection: "row", gap: 10, marginBottom: 10, alignItems: "flex-end" },
  podiumCard: { flex: 1, backgroundColor: "#111", borderRadius: 20, padding: 14, alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#1e1e1e" },
  podiumCardFirst: { backgroundColor: "#131208", borderColor: "rgba(245,158,11,0.35)", paddingTop: 18 },
  podiumCardMe: { borderColor: "rgba(6,182,212,0.35)" },
  crownRow: { position: "absolute", top: -14 },
  crownText: { fontSize: 22 },
  podiumMedal: { fontSize: 22 },
  podiumAvatar: { borderWidth: 2.5, backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center" },
  podiumAvatarText: { color: "#fff", fontWeight: "900" },
  podiumUsername: { color: "#fff", fontSize: 13, fontWeight: "800", textAlign: "center" },
  podiumScore: { fontSize: 17, fontWeight: "900", letterSpacing: -0.3 },
  podiumGame: { color: "#444", fontSize: 10, textAlign: "center" },

  // Rankings list (FlashList items wrap in a card via outer margins)
  listCard: { backgroundColor: "#111", borderRadius: 18, borderWidth: 1, borderColor: "#1e1e1e", overflow: "hidden", marginBottom: 0 },
  listHeader: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e1e1e" },
  listHeaderText: { color: "#333", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.2 },

  listRowWrap: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 10, backgroundColor: "#111" },
  listRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  listRank: { color: "#3a3a3a", fontSize: 13, fontWeight: "800", width: 32, textAlign: "center" },
  listTypeDot: { width: 8, height: 8, borderRadius: 4 },
  listInfo: { flex: 1 },
  listUsername: { color: "#fff", fontSize: 14, fontWeight: "700" },
  listYou: { color: "#555", fontWeight: "500" },
  listGame: { color: "#444", fontSize: 11, marginTop: 2 },
  listScore: { color: "#22c55e", fontSize: 17, fontWeight: "900" },
  listShareBtn: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: "rgba(6,182,212,0.08)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(6,182,212,0.15)",
  },

  pickerBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  pickerDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  pickerSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36,
    borderTopWidth: 1, borderColor: "#1e1e1e", gap: 12, maxHeight: "80%",
  },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 4 },
  pickerTitle: { color: "#fff", fontSize: 16, fontWeight: "900", textAlign: "center" },

  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#0d0d0d", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 14 },

  gameList: { maxHeight: 380 },
  gameOption: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 14, borderRadius: 14, marginBottom: 6,
    backgroundColor: "#0d0d0d", borderWidth: 1, borderColor: "#1a1a1a",
  },
  gameOptionActive: { borderColor: "#06b6d4", backgroundColor: "rgba(6,182,212,0.06)" },
  gameOptionLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  gameOptionName: { color: "#888", fontWeight: "700", fontSize: 14 },
  gameOptionNameActive: { color: "#fff" },

  noResults: { paddingVertical: 24, alignItems: "center" },
  noResultsText: { color: "#444", fontSize: 14 },

  pickerCancel: { backgroundColor: "#0d0d0d", borderRadius: 16, padding: 16, alignItems: "center" },
  pickerCancelText: { color: "#555", fontWeight: "700", fontSize: 15 },

  shareBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(6,182,212,0.1)", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5, marginTop: 4,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.2)",
  },
  shareBtnText: { color: "#06b6d4", fontSize: 11, fontWeight: "700" },

  shareSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36,
    borderTopWidth: 1, borderColor: "#1e1e1e", maxHeight: "80%",
  },
  shareScorePreview: {
    flexDirection: "row", alignItems: "center", gap: 16,
    backgroundColor: "#0d0d0d", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 20,
  },
  shareScoreRank: { color: "#06b6d4", fontSize: 28, fontWeight: "900", letterSpacing: -1 },
  shareScoreVal: { color: "#fff", fontSize: 18, fontWeight: "900" },
  shareScoreGame: { color: "#555", fontSize: 12, marginTop: 2 },

  shareSectionLabel: {
    color: "#444", fontSize: 11, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10,
  },
  shareFriendSearch: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#0d0d0d", borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 10,
  },
  shareFriendSearchInput: { flex: 1, color: "#fff", fontSize: 14 },
  shareFriendList: { maxHeight: 260 },
  shareFriendRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  shareFriendRowSent: { opacity: 0.6 },
  shareFriendAvatar: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#2a2a2a",
  },
  shareFriendAvatarText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  shareFriendName: { flex: 1, color: "#fff", fontSize: 14, fontWeight: "700" },
  shareSendBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#06b6d4", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  shareSendBtnText: { color: "#000", fontWeight: "800", fontSize: 12 },
  shareSentBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(34,197,94,0.1)", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: "rgba(34,197,94,0.2)",
  },
  shareSentText: { color: "#22c55e", fontSize: 12, fontWeight: "700" },
  shareNoFriends: { alignItems: "center", paddingVertical: 24, gap: 8 },
  shareNoFriendsText: { color: "#444", fontSize: 13, textAlign: "center" },
  shareExternalBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 16, backgroundColor: "#0d0d0d", borderRadius: 14,
    paddingVertical: 14, borderWidth: 1, borderColor: "#1e1e1e",
  },
  shareExternalBtnText: { color: "#555", fontWeight: "700", fontSize: 14 },
});
