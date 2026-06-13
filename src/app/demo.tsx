/**
 * Full app demo — all tabs, entirely mock data, no auth required.
 * Visit /demo in the browser to preview.
 */
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = "feed" | "games" | "food" | "teams" | "profile";

// ─── Mock data ────────────────────────────────────────────────────────────────

function ago(minutes: number) { return new Date(Date.now() - minutes * 60 * 1000).toISOString(); }
function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const AVATAR_COLORS: Record<string, string> = {
  you: "#06b6d4", Jake_Serpico: "#3b82f6", MsArcade_Quinn: "#a855f7",
  ArcadeHQ: "#22c55e", SkeeBallSam: "#f59e0b", NightOwl_Rex: "#ef4444",
  CaptainKatya: "#f97316", ArcadeVet: "#14b8a6", BallSlinger99: "#ec4899",
  RampKing: "#84cc16", NewPlayer_Josh: "#6366f1",
};

const POSTS = [
  { id: "p1", username: "Jake_Serpico", type: "post", content: "Crushed it on lane 3 tonight 🎳 New personal best by 30 points!", score: 450, game: "Skee-Ball", likes: 14, likedByMe: true, time: ago(12) },
  { id: "p2", username: "MsArcade_Quinn", type: "post", content: "Finally broke 28k on Twilight Zone after a month of grinding. The multiball is everything 🤌", score: 28400, game: "Twilight Zone Pinball", likes: 31, likedByMe: false, time: ago(45) },
  { id: "p3", username: "ArcadeHQ", type: "announcement", content: "🏆 Season 4 kicks off Friday night! Double points all weekend on every Skee-Ball lane. Leaderboard resets at midnight — who's ready?", score: null, game: null, likes: 62, likedByMe: false, time: ago(90) },
  { id: "p4", username: "SkeeBallSam", type: "post", content: "Consistent 380s this week. Slowly working my way up to the podium 💪", score: 390, game: "Skee-Ball", likes: 8, likedByMe: false, time: ago(180) },
  { id: "p5", username: "NightOwl_Rex", type: "post", content: "TRON Legacy is absolutely insane. Anyone else notice the bonus multiplier on the left ramp?", score: 14200, game: "TRON Legacy", likes: 19, likedByMe: true, time: ago(360) },
  { id: "p6", username: "CaptainKatya", type: "post", content: "Team Neon Rebels taking the top spot this season. Come find us on lane 2 every Thursday 🔵", score: null, game: null, likes: 44, likedByMe: false, time: ago(720) },
];

const GAMES = [
  { id: "g1", name: "Skee-Ball", type: "skeeball",   lanes: 3, desc: "Classic ring-toss scoring. 9 balls per game.", best: 450, plays: 23, top: 450 },
  { id: "g2", name: "Twilight Zone Pinball", type: "pinball", lanes: 1, desc: "Williams 1993. Multiball, powerfield, gumball machine.", best: 28400, plays: 12, top: 41800 },
  { id: "g3", name: "TRON Legacy",  type: "arcade",   lanes: 1, desc: "Light-cycle combat. Score multipliers at 10k.", best: 14200, plays: 8,  top: 21500 },
  { id: "g4", name: "NBA Hoops",    type: "basketball", lanes: 2, desc: "60-second shooting. Bonus time for streaks of 3+.", best: 85, plays: 5, top: 112 },
  { id: "g5", name: "Cosmic Air Hockey", type: "airhockey", lanes: 2, desc: "First to 7 goals wins.", best: 7, plays: 3, top: 7 },
];

const LEADER_ENTRIES = [
  { rank: 1, username: "Jake_Serpico",   score: 450,   game: "Skee-Ball",  uid: "u1" },
  { rank: 2, username: "ArcadeVet",      score: 440,   game: "Skee-Ball",  uid: "u2" },
  { rank: 3, username: "SkeeBallSam",    score: 415,   game: "Skee-Ball",  uid: "u3" },
  { rank: 4, username: "MsArcade_Quinn", score: 28400, game: "Twilight Zone", uid: "u4" },
  { rank: 5, username: "NightOwl_Rex",   score: 14200, game: "TRON Legacy",  uid: "u5" },
  { rank: 6, username: "CaptainKatya",   score: 405,   game: "Skee-Ball",  uid: "u6" },
  { rank: 7, username: "you",            score: 390,   game: "Skee-Ball",  uid: "me" },
  { rank: 8, username: "BallSlinger99",  score: 380,   game: "Skee-Ball",  uid: "u7" },
  { rank: 9, username: "RampKing",       score: 370,   game: "Skee-Ball",  uid: "u8" },
  { rank: 10, username: "NewPlayer_Josh", score: 310,  game: "Skee-Ball",  uid: "u9" },
];

const MENU_ITEMS = [
  { id: "m1", name: "Buffalo Wings",    cat: "Starters", price: 12.99, desc: "12 crispy wings, choice of sauce", emoji: "🍗" },
  { id: "m2", name: "Loaded Nachos",    cat: "Starters", price: 10.99, desc: "Tortilla chips, cheese, jalapeños", emoji: "🧀" },
  { id: "m3", name: "Arcade Burger",    cat: "Mains",    price: 14.99, desc: "8oz smash patty, cheddar, brioche bun", emoji: "🍔" },
  { id: "m4", name: "Hot Dog",          cat: "Mains",    price: 8.99,  desc: "All-beef frank, mustard, relish", emoji: "🌭" },
  { id: "m5", name: "Pretzel Bites",    cat: "Snacks",   price: 7.99,  desc: "Warm soft pretzel bites, cheese dip", emoji: "🥨" },
  { id: "m6", name: "French Fries",     cat: "Snacks",   price: 5.99,  desc: "Crispy golden fries, seasoned salt", emoji: "🍟" },
  { id: "m7", name: "Craft Beer",       cat: "Drinks",   price: 7.00,  desc: "Local rotating tap selection", emoji: "🍺" },
  { id: "m8", name: "Arcade Punch",     cat: "Drinks",   price: 5.00,  desc: "Non-alcoholic fruit punch", emoji: "🥤" },
  { id: "m9", name: "Draft Lemonade",   cat: "Drinks",   price: 4.00,  desc: "Fresh squeezed, mint garnish", emoji: "🍋" },
];

const TEAMS = [
  { id: "t1", name: "Neon Rebels",    tag: "NR", color: "#06b6d4", members: 5, rank: 1, avg: 410, role: "captain", joined: true },
  { id: "t2", name: "Pinball Wizards", tag: "PW", color: "#a855f7", members: 4, rank: 2, avg: 385, role: "member", joined: true },
  { id: "t3", name: "Speed Rollers",  tag: "SR", color: "#f59e0b", members: 6, rank: 3, avg: 362, role: null, joined: false },
  { id: "t4", name: "Lane Breakers",  tag: "LB", color: "#ef4444", members: 3, rank: 4, avg: 340, role: null, joined: false },
];

const TEAM_PLAYERS = [
  { username: "you",           games: 23, avg: 390, best: 450, role: "captain" },
  { username: "Jake_Serpico",  games: 31, avg: 421, best: 450, role: "member" },
  { username: "NightOwl_Rex",  games: 18, avg: 375, best: 410, role: "member" },
  { username: "SkeeBallSam",   games: 26, avg: 388, best: 415, role: "member" },
  { username: "BallSlinger99", games: 14, avg: 362, best: 390, role: "member" },
];

const CHATS = [
  { id: "c1", name: "Neon Rebels",    isGroup: true,  color: "#06b6d4", last: "Jake_Serpico: Let's run lane 2 tonight 🎳", time: ago(8),   unread: 3 },
  { id: "c2", name: "Jake_Serpico",   isGroup: false, color: AVATAR_COLORS["Jake_Serpico"], last: "Nice game yesterday bro!", time: ago(45),  unread: 1 },
  { id: "c3", name: "Pinball Wizards", isGroup: true, color: "#a855f7", last: "MsArcade_Quinn: Anyone up for Twilight tonight?", time: ago(120), unread: 0 },
  { id: "c4", name: "SkeeBallSam",    isGroup: false, color: AVATAR_COLORS["SkeeBallSam"], last: "Good game! You're getting consistent 🔥", time: ago(360), unread: 0 },
];

const PENDING_REVIEWS = [
  { id: "r1", username: "SkeeBallSam",    game: "Skee-Ball", score: 430, time: ago(30)  },
  { id: "r2", username: "NewPlayer_Josh", game: "Skee-Ball", score: 280, time: ago(90)  },
  { id: "r3", username: "RampKing",       game: "Twilight Zone", score: 12000, time: ago(180) },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gameColor(t: string) {
  return ({ skeeball: "#06b6d4", pinball: "#a855f7", arcade: "#f59e0b", basketball: "#f97316", airhockey: "#22c55e" } as any)[t] ?? "#888";
}
function gameIcon(t: string): React.ComponentProps<typeof Ionicons>["name"] {
  return (({ skeeball: "bowling-ball-outline", pinball: "radio-outline", arcade: "game-controller-outline", basketball: "basketball-outline", airhockey: "disc-outline" } as any)[t] ?? "game-controller-outline");
}
function gameLabel(t: string) {
  return ({ skeeball: "Skee-Ball", pinball: "Pinball", arcade: "Arcade", basketball: "Basketball", airhockey: "Air Hockey" } as any)[t] ?? t;
}

function Avatar({ name, size = 40, color }: { name: string; size?: number; color?: string }) {
  const bg = color ?? AVATAR_COLORS[name] ?? "#06b6d4";
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#000", fontWeight: "900", fontSize: size * 0.38 }}>{name[0].toUpperCase()}</Text>
    </View>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function DemoScreen() {
  const [activeTab, setActiveTab] = useState<TabKey>("feed");

  const TABS: { key: TabKey; icon: React.ComponentProps<typeof Ionicons>["name"]; iconActive: React.ComponentProps<typeof Ionicons>["name"]; label: string }[] = [
    { key: "feed",    icon: "home-outline",            iconActive: "home",            label: "Feed" },
    { key: "games",   icon: "game-controller-outline", iconActive: "game-controller", label: "Games" },
    { key: "food",    icon: "restaurant-outline",      iconActive: "restaurant",      label: "Food" },
    { key: "teams",   icon: "people-outline",          iconActive: "people",          label: "Teams" },
    { key: "profile", icon: "person-outline",          iconActive: "person",          label: "Profile" },
  ];

  return (
    <View style={g.root}>
      <SafeAreaView style={g.safe} edges={["top"]}>
        {/* Demo notice */}
        <View style={g.notice}>
          <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace("/login" as any)} style={g.noticeBack}>
            <Ionicons name="arrow-back" size={16} color="#555" />
          </Pressable>
          <View style={g.noticeBadge}><Text style={g.noticeBadgeText}>DEMO</Text></View>
          <Text style={g.noticeText}>Mock data · no account needed</Text>
        </View>

        {activeTab === "feed"    && <FeedTab />}
        {activeTab === "games"   && <GamesTab />}
        {activeTab === "food"    && <FoodTab />}
        {activeTab === "teams"   && <TeamsTab />}
        {activeTab === "profile" && <ProfileTab onAdmin={() => {}} />}
      </SafeAreaView>

      {/* Bottom tab bar */}
      <View style={g.tabBar}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          const badge = tab.key === "feed" ? CHATS.filter(c => c.unread > 0).length : 0;
          return (
            <Pressable key={tab.key} style={({ pressed }) => [g.tabItem, pressed && { opacity: 0.5 }]} onPress={() => setActiveTab(tab.key)}>
              <View style={[g.tabIconWrap, active && g.tabIconWrapActive]}>
                <Ionicons name={active ? tab.iconActive : tab.icon} size={22} color={active ? "#06b6d4" : "#484848"} />
                {badge > 0 && <View style={g.tabBadge}><Text style={g.tabBadgeText}>{badge}</Text></View>}
              </View>
              <Text style={[g.tabLabel, active && g.tabLabelActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Feed Tab ─────────────────────────────────────────────────────────────────

function FeedTab() {
  const [feedTab, setFeedTab] = useState<"following" | "arcade">("following");
  const [likes, setLikes] = useState<Record<string, boolean>>(Object.fromEntries(POSTS.map(p => [p.id, p.likedByMe])));
  const [counts, setCounts] = useState<Record<string, number>>(Object.fromEntries(POSTS.map(p => [p.id, p.likes])));
  const [menuPost, setMenuPost] = useState<string | null>(null);

  function toggleLike(id: string) {
    const liked = likes[id];
    setLikes(p => ({ ...p, [id]: !liked }));
    setCounts(p => ({ ...p, [id]: liked ? p[id] - 1 : p[id] + 1 }));
  }

  const visible = feedTab === "arcade" ? POSTS.filter(p => p.type === "announcement") : POSTS;

  return (
    <View style={{ flex: 1 }}>
      <View style={f.header}>
        <View style={f.brand}>
          <View style={f.brandDot} />
          <Text style={f.brandText}>Arcade</Text>
        </View>
        <View style={f.headerRight}>
          <View style={f.iconBtn}><Ionicons name="chatbubble-outline" size={21} color="#888" /></View>
          <View style={f.iconBtnCyan}><Ionicons name="add" size={20} color="#000" /></View>
        </View>
      </View>

      <View style={f.tabRow}>
        <View style={f.tabPill}>
          {(["following", "arcade"] as const).map(t => (
            <Pressable key={t} style={[f.tab, feedTab === t && f.tabActive]} onPress={() => setFeedTab(t)}>
              <Text style={[f.tabText, feedTab === t && f.tabTextActive]}>{t === "following" ? "Following" : "Arcade"}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {visible.map(post => {
          const isAnnouncement = post.type === "announcement";
          const hasScore = post.score != null;
          const likedByMe = likes[post.id];
          const isMe = post.username === "you";
          return (
            <View key={post.id} style={[f.postCard, isAnnouncement && f.postCardOfficial]}>
              <View style={f.postHeader}>
                <Avatar name={post.username} size={44} />
                <View style={{ flex: 1 }}>
                  <View style={f.postAuthorRow}>
                    <Text style={f.postAuthor}>{post.username}</Text>
                    {isAnnouncement && (
                      <View style={f.officialTag}>
                        <Ionicons name="shield-checkmark" size={9} color="#06b6d4" />
                        <Text style={f.officialTagText}>Official</Text>
                      </View>
                    )}
                  </View>
                  <Text style={f.postTime}>{relTime(post.time)}</Text>
                </View>
                {(isMe || isAnnouncement) && (
                  <Pressable style={f.menuBtn} onPress={() => setMenuPost(post.id)}>
                    <Ionicons name="ellipsis-horizontal" size={18} color="#444" />
                  </Pressable>
                )}
              </View>

              {hasScore && (
                <View style={f.scoreBlock}>
                  <View>
                    <Text style={f.scoreBlockLabel}>NEW SCORE</Text>
                    <Text style={f.scoreBlockValue}>{post.score!.toLocaleString()}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 6 }}>
                    <View style={f.trophyCircle}><Ionicons name="trophy" size={20} color="#f59e0b" /></View>
                    <Text style={f.scoreBlockGame}>{post.game}</Text>
                  </View>
                </View>
              )}

              {post.content ? <Text style={f.postContent}>{post.content}</Text> : null}

              <View style={f.postFooter}>
                <Pressable style={f.likeBtn} onPress={() => toggleLike(post.id)}>
                  <View style={[f.likeWrap, likedByMe && f.likeWrapActive]}>
                    <Ionicons name={likedByMe ? "heart" : "heart-outline"} size={15} color={likedByMe ? "#ef4444" : "#505050"} />
                  </View>
                  {counts[post.id] > 0 && (
                    <Text style={[f.likeCount, likedByMe && { color: "#ef4444" }]}>{counts[post.id]}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          );
        })}
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Post action sheet */}
      <Modal visible={!!menuPost} transparent animationType="fade" onRequestClose={() => setMenuPost(null)}>
        <Pressable style={f.menuOverlay} onPress={() => setMenuPost(null)}>
          <View style={f.menuSheet}>
            <Pressable style={f.menuItem} onPress={() => setMenuPost(null)}>
              <Ionicons name="pencil-outline" size={16} color="#fff" />
              <Text style={f.menuItemText}>Edit Post</Text>
            </Pressable>
            <Pressable style={f.menuItem} onPress={() => setMenuPost(null)}>
              <Ionicons name="trash-outline" size={16} color="#ef4444" />
              <Text style={[f.menuItemText, { color: "#ef4444" }]}>Delete Post</Text>
            </Pressable>
            <View style={f.menuDivider} />
            <Pressable style={f.menuItem} onPress={() => setMenuPost(null)}>
              <Text style={f.menuCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Games Tab ────────────────────────────────────────────────────────────────

function GamesTab() {
  const [view, setView] = useState<"games" | "leaderboard">("games");
  const [timeFilter, setTimeFilter] = useState<"alltime" | "season">("alltime");
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [gamePickerVisible, setGamePickerVisible] = useState(false);

  const filtered = selectedGame ? LEADER_ENTRIES.filter(e => GAMES.find(g => g.name === e.game && e.game === selectedGame)) : LEADER_ENTRIES;
  const top3 = LEADER_ENTRIES.slice(0, 3);
  const rest = LEADER_ENTRIES.slice(3);

  if (view === "leaderboard") {
    return (
      <View style={{ flex: 1 }}>
        <View style={lb.header}>
          <Pressable style={lb.backBtn} onPress={() => setView("games")}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <View>
            <Text style={lb.headerTitle}>Leaderboard</Text>
            <Text style={lb.headerSub}>Top scores across the arcade</Text>
          </View>
          <View style={lb.podiumIcon}><Ionicons name="podium" size={20} color="#f59e0b" /></View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 28 }}>
          {/* Time filter */}
          <View style={lb.filterRow}>
            {(["alltime", "season"] as const).map(tf => (
              <Pressable key={tf} style={[lb.filterBtn, timeFilter === tf && lb.filterBtnActive]} onPress={() => setTimeFilter(tf)}>
                <Text style={[lb.filterText, timeFilter === tf && lb.filterTextActive]}>{tf === "alltime" ? "All Time" : "This Season"}</Text>
              </Pressable>
            ))}
          </View>

          {/* Game selector */}
          <Pressable style={lb.gameSelector} onPress={() => setGamePickerVisible(true)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {selectedGame ? (
                <>
                  <View style={[lb.gameDot, { backgroundColor: gameColor(GAMES.find(g => g.name === selectedGame)?.type ?? "") }]} />
                  <Text style={lb.gameSelectorText}>{selectedGame}</Text>
                </>
              ) : (
                <>
                  <Ionicons name="game-controller-outline" size={16} color="#555" />
                  <Text style={lb.gameSelectorPlaceholder}>All Games</Text>
                </>
              )}
            </View>
            <Ionicons name="chevron-down" size={16} color="#444" />
          </Pressable>

          {/* My rank */}
          <View style={lb.myRankCard}>
            <View>
              <Text style={lb.myRankLabel}>YOUR RANK</Text>
              <Text style={lb.myRankValue}>#7</Text>
            </View>
            <View style={lb.myRankDivider} />
            <View>
              <Text style={lb.myScoreLabel}>YOUR BEST</Text>
              <Text style={lb.myScoreValue}>390</Text>
            </View>
          </View>

          {/* Podium */}
          <View style={lb.podium}>
            {[top3[1], top3[0], top3[2]].map((e) => {
              const medals = ["🥇", "🥈", "🥉"];
              const accents = ["#f59e0b", "#94a3b8", "#b45309"];
              const accent = accents[e.rank - 1];
              const sz = e.rank === 1 ? 68 : 54;
              return (
                <View key={e.rank} style={[lb.podiumCard, e.rank === 1 && lb.podiumCardFirst, { flex: e.rank === 1 ? 1.2 : 1 }]}>
                  {e.rank === 1 && <View style={{ position: "absolute", top: -14 }}><Text style={{ fontSize: 22 }}>👑</Text></View>}
                  <Text style={{ fontSize: 20 }}>{medals[e.rank - 1]}</Text>
                  <View style={[lb.podiumAvatar, { width: sz, height: sz, borderRadius: sz / 2, borderColor: accent }]}>
                    <Text style={{ color: "#fff", fontWeight: "900", fontSize: sz * 0.36 }}>{e.username[0].toUpperCase()}</Text>
                  </View>
                  <Text style={lb.podiumName} numberOfLines={1}>{e.username}</Text>
                  <Text style={[lb.podiumScore, { color: accent }]}>{e.score.toLocaleString()}</Text>
                  <Text style={lb.podiumGame} numberOfLines={1}>{e.game}</Text>
                </View>
              );
            })}
          </View>

          {/* Rest */}
          <View style={lb.listCard}>
            <View style={lb.listHeader}><Text style={lb.listHeaderText}>RANKINGS</Text></View>
            {rest.map((e, i) => (
              <View key={`${e.uid}-${i}`} style={[lb.listRow, i < rest.length - 1 && lb.listRowBorder]}>
                <Text style={lb.listRank}>#{e.rank}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={lb.listUsername}>{e.username}{e.uid === "me" ? <Text style={lb.listYou}> · you</Text> : ""}</Text>
                  <Text style={lb.listGame}>{e.game}</Text>
                </View>
                <Text style={lb.listScore}>{e.score.toLocaleString()}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* Game picker */}
        <Modal visible={gamePickerVisible} transparent animationType="slide" onRequestClose={() => setGamePickerVisible(false)}>
          <View style={lb.pickerBg}>
            <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={() => setGamePickerVisible(false)} />
            <View style={lb.pickerSheet}>
              <View style={lb.pickerHandle} />
              <Text style={lb.pickerTitle}>Select Game</Text>
              <Pressable style={[lb.gameOption, !selectedGame && lb.gameOptionActive]} onPress={() => { setSelectedGame(null); setGamePickerVisible(false); }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Ionicons name="game-controller-outline" size={14} color={!selectedGame ? "#06b6d4" : "#555"} />
                  <Text style={[lb.gameOptionName, !selectedGame && { color: "#fff" }]}>All Games</Text>
                </View>
                {!selectedGame && <Ionicons name="checkmark-circle" size={18} color="#06b6d4" />}
              </Pressable>
              {GAMES.map(g => (
                <Pressable key={g.id} style={[lb.gameOption, selectedGame === g.name && lb.gameOptionActive]} onPress={() => { setSelectedGame(g.name); setGamePickerVisible(false); }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={[lb.gameDot, { backgroundColor: gameColor(g.type) }]} />
                    <Text style={[lb.gameOptionName, selectedGame === g.name && { color: "#fff" }]}>{g.name}</Text>
                  </View>
                  {selectedGame === g.name && <Ionicons name="checkmark-circle" size={18} color="#06b6d4" />}
                </Pressable>
              ))}
              <Pressable style={lb.pickerCancel} onPress={() => setGamePickerVisible(false)}>
                <Text style={lb.pickerCancelText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={gm.content}>
      <View style={gm.pageHeader}>
        <View>
          <Text style={gm.pageTitle}>Games</Text>
          <Text style={gm.pageSub}>Track your scores across every machine</Text>
        </View>
        <View style={gm.ctaBtn}>
          <Ionicons name="add" size={18} color="#000" />
          <Text style={gm.ctaBtnText}>Submit Score</Text>
        </View>
      </View>

      <View style={gm.strip}>
        {[["5", "Games"], ["3", "Played Today"], ["51", "Total Plays"]].map(([val, lbl], i) => (
          <View key={lbl} style={{ flexDirection: "row", flex: 1 }}>
            {i > 0 && <View style={gm.stripDivider} />}
            <View style={gm.stripItem}>
              <Text style={gm.stripValue}>{val}</Text>
              <Text style={gm.stripLabel}>{lbl}</Text>
            </View>
          </View>
        ))}
      </View>

      {GAMES.map(game => {
        const color = gameColor(game.type);
        return (
          <View key={game.id} style={gm.card}>
            <View style={gm.cardTop}>
              <View style={[gm.iconWrap, { backgroundColor: color + "1a" }]}>
                <Ionicons name={gameIcon(game.type)} size={22} color={color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={gm.gameName}>{game.name}</Text>
                <View style={gm.tagRow}>
                  <View style={[gm.tag, { borderColor: color + "40", backgroundColor: color + "12" }]}>
                    <Text style={[gm.tagText, { color }]}>{gameLabel(game.type)}</Text>
                  </View>
                  <Text style={gm.lanes}>{game.lanes} {game.lanes === 1 ? "lane" : "lanes"}</Text>
                </View>
              </View>
            </View>
            <Text style={gm.desc}>{game.desc}</Text>
            <View style={gm.statsRow}>
              <View style={gm.statBlock}>
                <Text style={gm.statLabel}>YOUR BEST</Text>
                <Text style={gm.statValue}>{game.best.toLocaleString()}</Text>
              </View>
              <View style={gm.statBlock}>
                <Text style={gm.statLabel}>PLAYS</Text>
                <Text style={gm.statValue}>{game.plays}</Text>
              </View>
              <View style={gm.statBlock}>
                <Text style={gm.statLabel}>TOP SCORE</Text>
                <Text style={[gm.statValue, { color: "#f59e0b" }]}>{game.top.toLocaleString()}</Text>
              </View>
              <Pressable style={[gm.playBtn, { backgroundColor: color }]}>
                <Text style={gm.playBtnText}>Play</Text>
                <Ionicons name="arrow-forward" size={12} color="#000" />
              </Pressable>
            </View>
          </View>
        );
      })}

      <Pressable style={gm.leaderLink} onPress={() => setView("leaderboard")}>
        <Ionicons name="podium-outline" size={16} color="#06b6d4" />
        <Text style={gm.leaderLinkText}>View Full Leaderboard</Text>
        <Ionicons name="chevron-forward" size={14} color="#06b6d4" />
      </Pressable>
    </ScrollView>
  );
}

// ─── Food Tab ─────────────────────────────────────────────────────────────────

function FoodTab() {
  const [location, setLocation] = useState<"arcade" | "vinyl">("arcade");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartVisible, setCartVisible] = useState(false);

  const isVinyl = location === "vinyl";
  const CATS = ["All", "Starters", "Mains", "Snacks", "Drinks"];
  const visible = category === "All" ? MENU_ITEMS : MENU_ITEMS.filter(i => i.cat === category);
  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const cartTotal = Object.entries(cart).reduce((sum, [id, qty]) => sum + (MENU_ITEMS.find(i => i.id === id)?.price ?? 0) * qty, 0);

  function add(id: string) { setCart(c => ({ ...c, [id]: (c[id] ?? 0) + 1 })); }
  function remove(id: string) { setCart(c => { const n = { ...c }; if (n[id] > 1) n[id]--; else delete n[id]; return n; }); }

  return (
    <View style={{ flex: 1 }}>
      <View style={fd.header}>
        <View>
          <Text style={fd.headerTitle}>{isVinyl ? "Kitchen" : "Food"}</Text>
          <Text style={fd.headerSub}>{isVinyl ? "Full kitchen menu" : "Order to your lane"}</Text>
        </View>
        <Pressable style={[fd.cartBtn, cartCount > 0 && fd.cartBtnActive]} onPress={() => setCartVisible(true)}>
          <Ionicons name="bag-outline" size={20} color={cartCount > 0 ? "#000" : "#fff"} />
          {cartCount > 0 && <View style={fd.cartBadge}><Text style={fd.cartBadgeText}>{cartCount}</Text></View>}
        </Pressable>
      </View>

      {/* Location switcher */}
      <View style={fd.locationRow}>
        <Pressable style={[fd.locBtn, !isVinyl && fd.locBtnActive]} onPress={() => setLocation("arcade")}>
          <Ionicons name="business-outline" size={13} color={!isVinyl ? "#fff" : "#444"} />
          <Text style={[fd.locText, !isVinyl && fd.locTextActive]}>Arcade Bar</Text>
        </Pressable>
        <Pressable style={[fd.locBtn, isVinyl && fd.locBtnVinyl]} onPress={() => setLocation("vinyl")}>
          <Ionicons name="disc-outline" size={13} color={isVinyl ? "#a855f7" : "#444"} />
          <Text style={[fd.locText, isVinyl && fd.locTextVinyl]}>Vinyl Hall</Text>
        </Pressable>
      </View>

      {/* Category tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={fd.catRow}>
        {CATS.map(c => (
          <Pressable key={c} style={[fd.catBtn, category === c && fd.catBtnActive]} onPress={() => setCategory(c)}>
            <Text style={[fd.catText, category === c && fd.catTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={fd.content}>
        {visible.map(item => {
          const qty = cart[item.id] ?? 0;
          return (
            <View key={item.id} style={fd.itemCard}>
              <View style={fd.itemEmoji}><Text style={{ fontSize: 28 }}>{item.emoji}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={fd.itemName}>{item.name}</Text>
                <Text style={fd.itemDesc}>{item.desc}</Text>
                <Text style={fd.itemPrice}>${item.price.toFixed(2)}</Text>
              </View>
              <View style={fd.qtyRow}>
                {qty > 0 ? (
                  <>
                    <Pressable style={fd.qtyBtn} onPress={() => remove(item.id)}>
                      <Ionicons name="remove" size={16} color="#06b6d4" />
                    </Pressable>
                    <Text style={fd.qtyText}>{qty}</Text>
                  </>
                ) : null}
                <Pressable style={[fd.addBtn, qty > 0 && fd.addBtnActive]} onPress={() => add(item.id)}>
                  <Ionicons name="add" size={18} color={qty > 0 ? "#000" : "#06b6d4"} />
                </Pressable>
              </View>
            </View>
          );
        })}
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Cart modal */}
      <Modal visible={cartVisible} transparent animationType="slide" onRequestClose={() => setCartVisible(false)}>
        <View style={fd.cartBg}>
          <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={() => setCartVisible(false)} />
          <View style={fd.cartSheet}>
            <View style={fd.cartHandle} />
            <Text style={fd.cartTitle}>Your Order</Text>
            {cartCount === 0 ? (
              <View style={fd.cartEmpty}>
                <Text style={fd.cartEmptyText}>No items added yet</Text>
              </View>
            ) : (
              <>
                {Object.entries(cart).map(([id, qty]) => {
                  const item = MENU_ITEMS.find(i => i.id === id)!;
                  return (
                    <View key={id} style={fd.cartRow}>
                      <Text style={fd.cartRowEmoji}>{item.emoji}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={fd.cartRowName}>{item.name}</Text>
                        <Text style={fd.cartRowPrice}>${(item.price * qty).toFixed(2)}</Text>
                      </View>
                      <Text style={fd.cartRowQty}>×{qty}</Text>
                    </View>
                  );
                })}
                <View style={fd.cartTotalRow}>
                  <Text style={fd.cartTotalLabel}>Total</Text>
                  <Text style={fd.cartTotalValue}>${cartTotal.toFixed(2)}</Text>
                </View>
                <View style={fd.checkoutBtn}>
                  <Ionicons name="card-outline" size={18} color="#000" />
                  <Text style={fd.checkoutBtnText}>Checkout via Square</Text>
                </View>
              </>
            )}
            <Pressable style={fd.cartCancel} onPress={() => setCartVisible(false)}>
              <Text style={fd.cartCancelText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Teams Tab ────────────────────────────────────────────────────────────────

function TeamsTab() {
  const [expanded, setExpanded] = useState<string | null>("t1");

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={tm.content}>
      <View style={tm.pageHeader}>
        <View>
          <Text style={tm.pageTitle}>Teams</Text>
          <Text style={tm.pageSub}>Compete together, rise together</Text>
        </View>
        <View style={tm.createBtn}><Ionicons name="add" size={18} color="#000" /><Text style={tm.createBtnText}>Create</Text></View>
      </View>

      <Text style={tm.sectionLabel}>MY TEAMS</Text>
      {TEAMS.filter(t => t.joined).map(team => (
        <View key={team.id}>
          <Pressable style={tm.card} onPress={() => setExpanded(expanded === team.id ? null : team.id)}>
            <View style={[tm.teamIcon, { backgroundColor: team.color + "1a", borderColor: team.color + "33" }]}>
              <Text style={[tm.teamIconText, { color: team.color }]}>{team.tag}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={tm.teamNameRow}>
                <Text style={tm.teamName}>{team.name}</Text>
                {team.role === "captain" && (
                  <View style={tm.captainBadge}>
                    <Ionicons name="star" size={9} color="#f59e0b" />
                    <Text style={tm.captainBadgeText}>Captain</Text>
                  </View>
                )}
              </View>
              <Text style={tm.teamMeta}>{team.members} members · Rank #{team.rank}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 3 }}>
              <Text style={[tm.teamAvg, { color: team.color }]}>{team.avg}</Text>
              <Text style={tm.teamAvgLabel}>avg</Text>
            </View>
            <Ionicons name={expanded === team.id ? "chevron-up" : "chevron-down"} size={16} color="#333" style={{ marginLeft: 4 }} />
          </Pressable>

          {expanded === team.id && (
            <View style={tm.memberList}>
              <View style={tm.memberListHeader}>
                <Text style={tm.memberListTitle}>SKEE-BALL · SEASON 1</Text>
                <View style={tm.skeeballTag}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#06b6d4" }} />
                  <Text style={tm.skeeballTagText}>Approved only</Text>
                </View>
              </View>
              <View style={tm.memberStatHeader}>
                <Text style={[tm.memberStatCol, { flex: 1 }]}>Player</Text>
                <Text style={tm.memberStatCol}>Games</Text>
                <Text style={tm.memberStatCol}>Avg</Text>
                <Text style={tm.memberStatCol}>Best</Text>
              </View>
              {TEAM_PLAYERS.sort((a, b) => b.avg - a.avg).map((p, i) => (
                <View key={p.username} style={[tm.memberRow, i < TEAM_PLAYERS.length - 1 && tm.memberRowBorder]}>
                  <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Avatar name={p.username} size={32} />
                    <View>
                      <Text style={tm.memberName}>{p.username === "you" ? "you (me)" : p.username}</Text>
                      {p.role === "captain" && <Text style={tm.captainLabel}>Captain</Text>}
                    </View>
                  </View>
                  <Text style={tm.memberStat}>{p.games}</Text>
                  <Text style={tm.memberStat}>{p.avg}</Text>
                  <Text style={[tm.memberStat, { color: "#22c55e" }]}>{p.best}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}

      <View style={{ height: 20 }} />
      <Text style={tm.sectionLabel}>DISCOVER TEAMS</Text>
      {TEAMS.filter(t => !t.joined).map(team => (
        <View key={team.id} style={tm.card}>
          <View style={[tm.teamIcon, { backgroundColor: team.color + "1a", borderColor: team.color + "33" }]}>
            <Text style={[tm.teamIconText, { color: team.color }]}>{team.tag}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={tm.teamName}>{team.name}</Text>
            <Text style={tm.teamMeta}>{team.members} members · Rank #{team.rank} · avg {team.avg}</Text>
          </View>
          <View style={tm.joinBtn}><Text style={tm.joinBtnText}>Join</Text></View>
        </View>
      ))}
    </ScrollView>
  );
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab({ onAdmin }: { onAdmin: () => void }) {
  const [view, setView] = useState<"profile" | "admin">("profile");
  const [pendingScores, setPendingScores] = useState(PENDING_REVIEWS.map(r => ({ ...r, status: "pending" as "pending" | "approved" | "denied" })));

  if (view === "admin") {
    const pending = pendingScores.filter(r => r.status === "pending");
    return (
      <View style={{ flex: 1 }}>
        <View style={ad.header}>
          <Pressable style={ad.backBtn} onPress={() => setView("profile")}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={ad.headerTitle}>Admin Panel</Text>
            <Text style={ad.headerSub}>Score review queue</Text>
          </View>
          {pending.length > 0 && (
            <View style={ad.countBadge}><Text style={ad.countBadgeText}>{pending.length}</Text></View>
          )}
        </View>

        {/* Tabs */}
        <View style={ad.tabBar}>
          {[["checkmark-done-outline", "Reviews"], ["bar-chart-outline", "Stats"], ["pulse-outline", "Health"]].map(([icon, lbl]) => (
            <Pressable key={lbl} style={[ad.tabItem, lbl === "Reviews" && ad.tabItemActive]}>
              <Ionicons name={icon as any} size={15} color={lbl === "Reviews" ? "#f59e0b" : "#444"} />
              <Text style={[ad.tabLabel, lbl === "Reviews" && ad.tabLabelActive]}>{lbl}</Text>
            </Pressable>
          ))}
        </View>

        {/* Sub-tabs */}
        <View style={ad.subTabBar}>
          {["Pending", "Approved", "Denied"].map((t) => (
            <Pressable key={t} style={[ad.subTab, t === "Pending" && ad.subTabActive]}>
              <Text style={[ad.subTabText, t === "Pending" && ad.subTabTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
          {pending.length === 0 ? (
            <View style={ad.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={52} color="#22c55e" />
              <Text style={ad.emptyTitle}>All caught up!</Text>
              <Text style={ad.emptySub}>No pending scores to review.</Text>
            </View>
          ) : (
            pending.map(r => (
              <View key={r.id} style={ad.card}>
                <View style={ad.cardUser}>
                  <Avatar name={r.username} size={42} />
                  <View style={{ flex: 1 }}>
                    <Text style={ad.cardUsername}>{r.username}</Text>
                    <Text style={ad.cardGame}>{r.game} · {relTime(r.time)}</Text>
                  </View>
                  <Text style={ad.cardScore}>{r.score.toLocaleString()}</Text>
                </View>

                {/* Photo placeholder */}
                <View style={ad.photoPlaceholder}>
                  <Ionicons name="image-outline" size={24} color="#333" />
                  <Text style={ad.photoPlaceholderText}>Score proof photo</Text>
                  <View style={ad.photoExpandHint}>
                    <Ionicons name="expand-outline" size={12} color="#fff" />
                    <Text style={ad.photoHintText}>Tap to enlarge</Text>
                  </View>
                </View>

                <View style={ad.cardActions}>
                  <Pressable style={ad.denyBtn} onPress={() => setPendingScores(p => p.map(s => s.id === r.id ? { ...s, status: "denied" } : s))}>
                    <Ionicons name="close" size={17} color="#ef4444" />
                    <Text style={ad.denyText}>Deny</Text>
                  </Pressable>
                  <Pressable style={ad.approveBtn} onPress={() => setPendingScores(p => p.map(s => s.id === r.id ? { ...s, status: "approved" } : s))}>
                    <Ionicons name="checkmark" size={17} color="#000" />
                    <Text style={ad.approveText}>Approve</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}

          {/* Health snapshot */}
          <View style={{ marginTop: 8 }}>
            <Text style={ad.sectionLabel}>HEALTH SNAPSHOT</Text>
            <View style={ad.healthRow}>
              {[["12", "Total Users", "#06b6d4"], ["3", "Active Today", "#22c55e"], ["87%", "Approval Rate", "#f59e0b"]].map(([val, lbl, color]) => (
                <View key={lbl} style={ad.healthCard}>
                  <Text style={[ad.healthValue, { color }]}>{val}</Text>
                  <Text style={ad.healthLabel}>{lbl}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  const RECENT_SCORES = [
    { game: "Skee-Ball", score: 390, status: "approved", time: ago(180) },
    { game: "Skee-Ball", score: 420, status: "pending",  time: ago(360) },
    { game: "TRON Legacy", score: 14200, status: "approved", time: ago(720) },
    { game: "Twilight Zone", score: 8600, status: "approved", time: ago(2880) },
  ];

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={pr.content}>
      <View style={pr.hero}>
        <View style={{ position: "relative", marginBottom: 16 }}>
          <Avatar name="you" size={96} />
          <View style={pr.cameraChip}><Ionicons name="camera" size={13} color="#000" /></View>
        </View>
        <View style={pr.nameRow}>
          <Text style={pr.heroName}>you</Text>
          <Ionicons name="pencil-outline" size={14} color="#444" />
        </View>
        <Text style={pr.heroEmail}>you@example.com</Text>
        <View style={pr.teamPill}>
          <Ionicons name="star" size={11} color="#f59e0b" />
          <Text style={pr.teamPillText}>Neon Rebels · Captain</Text>
        </View>
      </View>

      {/* Featured game stats */}
      <View style={pr.featuredHeader}>
        <Text style={pr.sectionLabel}>SKEE-BALL</Text>
        <Pressable style={pr.changeBtn}>
          <Ionicons name="swap-horizontal-outline" size={13} color="#06b6d4" />
          <Text style={pr.changeBtnText}>Change</Text>
        </Pressable>
      </View>
      <View style={pr.statsRow}>
        {[["23", "Games", "#06b6d4"], ["450", "Best", "#22c55e"], ["388", "Average", "#a855f7"]].map(([val, lbl, color]) => (
          <View key={lbl} style={pr.statBox}>
            <Text style={[pr.statValue, { color }]}>{val}</Text>
            <Text style={pr.statLabel}>{lbl}</Text>
          </View>
        ))}
      </View>

      <View style={pr.pendingBanner}>
        <Ionicons name="time-outline" size={16} color="#f59e0b" />
        <Text style={pr.pendingText}>1 score pending admin review</Text>
      </View>

      <Text style={pr.sectionLabel}>RECENT SCORES</Text>
      <View style={pr.scoresCard}>
        {RECENT_SCORES.map((s, i) => (
          <View key={i} style={[pr.scoreRow, i < RECENT_SCORES.length - 1 && pr.scoreRowBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={pr.scoreGame}>{s.game}</Text>
              <Text style={pr.scoreTime}>{relTime(s.time)}</Text>
            </View>
            <View style={[pr.statusBadge, s.status === "pending" ? pr.statusPending : pr.statusApproved]}>
              <Text style={[pr.statusText, s.status === "pending" ? { color: "#f59e0b" } : { color: "#22c55e" }]}>
                {s.status === "pending" ? "Pending" : "Approved"}
              </Text>
            </View>
            <Text style={pr.scoreValue}>{s.score.toLocaleString()}</Text>
          </View>
        ))}
      </View>

      <Text style={pr.sectionLabel}>QUICK ACTIONS</Text>
      <View style={pr.actionsCard}>
        {([
          { icon: "qr-code-outline", label: "Scan Lane QR" },
          { icon: "people-outline", label: "Manage Teams", divider: true },
          { icon: "podium-outline", label: "Leaderboard", divider: true },
          { icon: "trophy-outline", label: "Leagues", divider: true },
          { icon: "shield-checkmark-outline", label: "Admin Panel", divider: true, amber: true, badge: 3 },
        ] as any[]).map((item, i) => (
          <View key={i}>
            {item.divider && <View style={pr.rowDivider} />}
            <Pressable style={pr.actionRow} onPress={item.amber ? () => setView("admin") : undefined}>
              <View style={[pr.actionIcon, item.amber && pr.actionIconAmber]}>
                <Ionicons name={item.icon} size={17} color={item.amber ? "#f59e0b" : "#06b6d4"} />
              </View>
              <Text style={pr.actionLabel}>{item.label}</Text>
              {item.badge && <View style={pr.actionBadge}><Text style={pr.actionBadgeText}>{item.badge}</Text></View>}
              <Ionicons name="chevron-forward" size={15} color="#2a2a2a" />
            </Pressable>
          </View>
        ))}
      </View>

      <View style={pr.logoutBtn}>
        <Ionicons name="log-out-outline" size={18} color="#ef4444" />
        <Text style={pr.logoutText}>Log Out</Text>
      </View>
    </ScrollView>
  );
}

// ─── Global styles ────────────────────────────────────────────────────────────

const g = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  safe: { flex: 1 },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  noticeBack: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  noticeBadge: { backgroundColor: "#06b6d4", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  noticeBadgeText: { color: "#000", fontWeight: "900", fontSize: 10, letterSpacing: 0.5 },
  noticeText: { color: "#777", fontSize: 12 },
  tabBar: { flexDirection: "row", backgroundColor: "#0a0a0a", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#222", paddingTop: 6, paddingBottom: 16 },
  tabItem: { flex: 1, alignItems: "center", gap: 3 },
  tabIconWrap: { width: 44, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", position: "relative" },
  tabIconWrapActive: { backgroundColor: "rgba(6,182,212,0.12)" },
  tabBadge: { position: "absolute", top: 0, right: 4, width: 16, height: 16, borderRadius: 8, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center" },
  tabBadgeText: { color: "#fff", fontSize: 9, fontWeight: "900" },
  tabLabel: { fontSize: 10, fontWeight: "500", color: "#484848" },
  tabLabelActive: { color: "#06b6d4", fontWeight: "700" },
});

// Feed
const f = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#06b6d4" },
  brandText: { color: "#fff", fontSize: 19, fontWeight: "900", letterSpacing: -0.4 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  iconBtnCyan: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center" },
  tabRow: { paddingHorizontal: 18, paddingVertical: 10 },
  tabPill: { flexDirection: "row", backgroundColor: "#141414", borderRadius: 12, padding: 3, borderWidth: 1, borderColor: "#222" },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  tabActive: { backgroundColor: "#1e1e1e" },
  tabText: { color: "#505050", fontWeight: "600", fontSize: 14 },
  tabTextActive: { color: "#fff", fontWeight: "800" },
  postCard: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#181818" },
  postCardOfficial: { backgroundColor: "rgba(6,182,212,0.03)" },
  postHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  postAuthorRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  postAuthor: { color: "#fff", fontSize: 15, fontWeight: "800" },
  officialTag: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(6,182,212,0.1)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  officialTagText: { color: "#06b6d4", fontSize: 10, fontWeight: "800" },
  postTime: { color: "#777", fontSize: 12, marginTop: 2 },
  menuBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16, marginLeft: 4 },
  scoreBlock: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(245,158,11,0.07)", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "rgba(245,158,11,0.15)", marginBottom: 12 },
  scoreBlockLabel: { color: "#f59e0b", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 3 },
  scoreBlockValue: { color: "#fff", fontSize: 28, fontWeight: "900" },
  trophyCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(245,158,11,0.12)", alignItems: "center", justifyContent: "center" },
  scoreBlockGame: { color: "#f59e0b", fontSize: 11, fontWeight: "700" },
  postContent: { color: "#c8c8c8", fontSize: 15, lineHeight: 22, marginBottom: 12 },
  postFooter: { flexDirection: "row", paddingTop: 6 },
  likeBtn: { flexDirection: "row", alignItems: "center", gap: 7 },
  likeWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#161616", alignItems: "center", justifyContent: "center" },
  likeWrapActive: { backgroundColor: "rgba(239,68,68,0.12)" },
  likeCount: { color: "#8a8a8a", fontSize: 13, fontWeight: "600" },
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  menuSheet: { backgroundColor: "#141414", borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: "#222", paddingBottom: 28, paddingTop: 8 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 22, paddingVertical: 16 },
  menuItemText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#222", marginHorizontal: 16 },
  menuCancelText: { color: "#8a8a8a", fontSize: 16, fontWeight: "600" },
});

// Games
const gm = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28 },
  pageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 },
  pageTitle: { color: "#fff", fontSize: 32, fontWeight: "900", letterSpacing: -0.5 },
  pageSub: { color: "#8a8a8a", fontSize: 14, marginTop: 2 },
  ctaBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#06b6d4", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  ctaBtnText: { color: "#000", fontWeight: "900", fontSize: 13 },
  strip: { flexDirection: "row", backgroundColor: "#141414", borderRadius: 16, borderWidth: 1, borderColor: "#222", paddingVertical: 16, marginBottom: 20 },
  stripItem: { flex: 1, alignItems: "center" },
  stripValue: { color: "#fff", fontSize: 22, fontWeight: "900" },
  stripLabel: { color: "#777", fontSize: 11, marginTop: 2 },
  stripDivider: { width: 1, backgroundColor: "#222" },
  card: { backgroundColor: "#111", borderRadius: 22, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: "#1a1a1a" },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 },
  iconWrap: { width: 50, height: 50, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  gameName: { color: "#fff", fontSize: 19, fontWeight: "900", marginBottom: 6 },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tag: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  tagText: { fontSize: 11, fontWeight: "800" },
  lanes: { color: "#777", fontSize: 12 },
  desc: { color: "#8a8a8a", fontSize: 13, lineHeight: 19, marginBottom: 14 },
  statsRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a" },
  statBlock: { flex: 1 },
  statLabel: { color: "#6b6b6b", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  statValue: { color: "#22c55e", fontSize: 20, fontWeight: "900" },
  playBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  playBtnText: { color: "#000", fontWeight: "900", fontSize: 13 },
  leaderLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 20 },
  leaderLinkText: { color: "#06b6d4", fontWeight: "700", fontSize: 14 },
});

// Leaderboard
const lb = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "#777", fontSize: 12 },
  podiumIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(245,158,11,0.1)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(245,158,11,0.2)" },
  filterRow: { flexDirection: "row", backgroundColor: "#141414", borderRadius: 14, padding: 4, gap: 4, marginBottom: 12, marginTop: 16, borderWidth: 1, borderColor: "#222" },
  filterBtn: { flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: "center" },
  filterBtnActive: { backgroundColor: "#1e1e1e" },
  filterText: { color: "#505050", fontWeight: "600", fontSize: 13 },
  filterTextActive: { color: "#fff", fontWeight: "800" },
  gameSelector: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#111", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#222", marginBottom: 18 },
  gameDot: { width: 10, height: 10, borderRadius: 5 },
  gameSelectorText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  gameSelectorPlaceholder: { color: "#777", fontSize: 14 },
  myRankCard: { flexDirection: "row", alignItems: "center", gap: 20, backgroundColor: "rgba(6,182,212,0.06)", borderRadius: 18, padding: 18, borderWidth: 1, borderColor: "rgba(6,182,212,0.2)", marginBottom: 22 },
  myRankLabel: { color: "#06b6d4", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 4 },
  myRankValue: { color: "#fff", fontSize: 32, fontWeight: "900" },
  myRankDivider: { width: 1, height: 36, backgroundColor: "rgba(6,182,212,0.2)" },
  myScoreLabel: { color: "#777", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 4 },
  myScoreValue: { color: "#22c55e", fontSize: 22, fontWeight: "900" },
  podium: { flexDirection: "row", gap: 10, marginBottom: 22, alignItems: "flex-end" },
  podiumCard: { flex: 1, backgroundColor: "#111", borderRadius: 20, padding: 14, alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#1a1a1a" },
  podiumCardFirst: { backgroundColor: "#131208", borderColor: "rgba(245,158,11,0.35)", paddingTop: 20 },
  podiumAvatar: { borderWidth: 2.5, backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center" },
  podiumName: { color: "#fff", fontSize: 12, fontWeight: "800", textAlign: "center" },
  podiumScore: { fontSize: 16, fontWeight: "900" },
  podiumGame: { color: "#777", fontSize: 10, textAlign: "center" },
  listCard: { backgroundColor: "#111", borderRadius: 18, borderWidth: 1, borderColor: "#1a1a1a", overflow: "hidden" },
  listHeader: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  listHeaderText: { color: "#333", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.2 },
  listRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  listRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  listRank: { color: "#6b6b6b", fontSize: 13, fontWeight: "800", width: 30, textAlign: "center" },
  listUsername: { color: "#fff", fontSize: 14, fontWeight: "700" },
  listYou: { color: "#8a8a8a", fontWeight: "500" },
  listGame: { color: "#777", fontSize: 11, marginTop: 2 },
  listScore: { color: "#22c55e", fontSize: 17, fontWeight: "900" },
  pickerBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36, borderTopWidth: 1, borderColor: "#1a1a1a", gap: 8 },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 8 },
  pickerTitle: { color: "#fff", fontSize: 16, fontWeight: "900", textAlign: "center", marginBottom: 8 },
  gameOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 14, backgroundColor: "#0d0d0d", borderWidth: 1, borderColor: "#1a1a1a" },
  gameOptionActive: { borderColor: "#06b6d4", backgroundColor: "rgba(6,182,212,0.06)" },
  gameOptionName: { color: "#888", fontWeight: "700", fontSize: 14 },
  pickerCancel: { backgroundColor: "#0d0d0d", borderRadius: 16, padding: 16, alignItems: "center", marginTop: 4 },
  pickerCancelText: { color: "#8a8a8a", fontWeight: "700", fontSize: 15 },
});

// Food
const fd = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  headerTitle: { color: "#fff", fontSize: 22, fontWeight: "900" },
  headerSub: { color: "#8a8a8a", fontSize: 12, marginTop: 2 },
  cartBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#222", position: "relative" },
  cartBtnActive: { backgroundColor: "#06b6d4" },
  cartBadge: { position: "absolute", top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center" },
  cartBadgeText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  locationRow: { flexDirection: "row", marginHorizontal: 18, marginVertical: 12, backgroundColor: "#0d0d0d", borderRadius: 12, padding: 4, borderWidth: 1, borderColor: "#1a1a1a", gap: 4 },
  locBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 9 },
  locBtnActive: { backgroundColor: "#1e1e1e" },
  locBtnVinyl: { backgroundColor: "rgba(168,85,247,0.1)" },
  locText: { color: "#777", fontSize: 13, fontWeight: "600" },
  locTextActive: { color: "#fff", fontWeight: "700" },
  locTextVinyl: { color: "#a855f7", fontWeight: "700" },
  catRow: { paddingHorizontal: 18, paddingBottom: 12, gap: 8 },
  catBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "#141414", borderWidth: 1, borderColor: "#222" },
  catBtnActive: { backgroundColor: "#06b6d4", borderColor: "#06b6d4" },
  catText: { color: "#8a8a8a", fontWeight: "600", fontSize: 13 },
  catTextActive: { color: "#000", fontWeight: "800" },
  content: { paddingHorizontal: 18, paddingBottom: 28 },
  itemCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#111", borderRadius: 18, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#1a1a1a" },
  itemEmoji: { width: 52, height: 52, borderRadius: 14, backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center" },
  itemName: { color: "#fff", fontSize: 15, fontWeight: "800", marginBottom: 3 },
  itemDesc: { color: "#777", fontSize: 12, lineHeight: 17, marginBottom: 5 },
  itemPrice: { color: "#22c55e", fontSize: 15, fontWeight: "900" },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  qtyBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(6,182,212,0.1)", alignItems: "center", justifyContent: "center" },
  qtyText: { color: "#fff", fontWeight: "800", fontSize: 15, minWidth: 18, textAlign: "center" },
  addBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(6,182,212,0.1)", borderWidth: 1, borderColor: "rgba(6,182,212,0.3)", alignItems: "center", justifyContent: "center" },
  addBtnActive: { backgroundColor: "#06b6d4", borderColor: "#06b6d4" },
  cartBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  cartSheet: { backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 36, borderTopWidth: 1, borderColor: "#1a1a1a", gap: 10 },
  cartHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 8 },
  cartTitle: { color: "#fff", fontSize: 18, fontWeight: "900", marginBottom: 4 },
  cartEmpty: { paddingVertical: 24, alignItems: "center" },
  cartEmptyText: { color: "#777", fontSize: 14 },
  cartRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  cartRowEmoji: { fontSize: 24 },
  cartRowName: { color: "#fff", fontWeight: "700", fontSize: 14 },
  cartRowPrice: { color: "#777", fontSize: 12, marginTop: 2 },
  cartRowQty: { color: "#888", fontWeight: "700", fontSize: 14 },
  cartTotalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 8 },
  cartTotalLabel: { color: "#888", fontSize: 14, fontWeight: "700" },
  cartTotalValue: { color: "#fff", fontSize: 22, fontWeight: "900" },
  checkoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#06b6d4", borderRadius: 16, padding: 16, marginTop: 4 },
  checkoutBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
  cartCancel: { backgroundColor: "#0d0d0d", borderRadius: 16, padding: 14, alignItems: "center" },
  cartCancelText: { color: "#8a8a8a", fontWeight: "700", fontSize: 14 },
});

// Teams
const tm = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28 },
  pageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 22 },
  pageTitle: { color: "#fff", fontSize: 32, fontWeight: "900", letterSpacing: -0.5 },
  pageSub: { color: "#8a8a8a", fontSize: 14, marginTop: 2 },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#06b6d4", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  createBtnText: { color: "#000", fontWeight: "900", fontSize: 13 },
  sectionLabel: { color: "#6b6b6b", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 12 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#111", borderRadius: 20, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#1a1a1a" },
  teamIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  teamIconText: { fontWeight: "900", fontSize: 14 },
  teamNameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 },
  teamName: { color: "#fff", fontSize: 16, fontWeight: "900" },
  captainBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(245,158,11,0.1)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  captainBadgeText: { color: "#f59e0b", fontSize: 10, fontWeight: "800" },
  teamMeta: { color: "#777", fontSize: 12 },
  teamAvg: { fontSize: 20, fontWeight: "900" },
  teamAvgLabel: { color: "#777", fontSize: 11 },
  joinBtn: { backgroundColor: "rgba(6,182,212,0.1)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: "rgba(6,182,212,0.25)" },
  joinBtnText: { color: "#06b6d4", fontWeight: "800", fontSize: 13 },
  memberList: { backgroundColor: "#0d0d0d", borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: "#1a1a1a", overflow: "hidden", marginTop: -8 },
  memberListHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, paddingBottom: 8 },
  memberListTitle: { color: "#333", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.2 },
  skeeballTag: { flexDirection: "row", alignItems: "center", gap: 5 },
  skeeballTagText: { color: "#06b6d4", fontSize: 10, fontWeight: "700" },
  memberStatHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  memberStatCol: { color: "#333", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, minWidth: 44, textAlign: "right" },
  memberRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 },
  memberRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  memberName: { color: "#fff", fontSize: 13, fontWeight: "700" },
  captainLabel: { color: "#f59e0b", fontSize: 10, fontWeight: "700", marginTop: 1 },
  memberStat: { color: "#888", fontSize: 13, fontWeight: "700", minWidth: 44, textAlign: "right" },
});

// Admin
const ad = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "#777", fontSize: 12, marginTop: 1 },
  countBadge: { minWidth: 28, height: 28, borderRadius: 14, backgroundColor: "#f59e0b", alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  countBadgeText: { color: "#000", fontWeight: "900", fontSize: 14 },
  tabBar: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a", paddingHorizontal: 16 },
  tabItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabItemActive: { borderBottomColor: "#f59e0b" },
  tabLabel: { color: "#777", fontSize: 13, fontWeight: "700" },
  tabLabelActive: { color: "#f59e0b" },
  subTabBar: { flexDirection: "row", paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  subTab: { flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  subTabActive: { borderBottomColor: "#06b6d4" },
  subTabText: { color: "#777", fontSize: 12, fontWeight: "700" },
  subTabTextActive: { color: "#06b6d4" },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyTitle: { color: "#fff", fontSize: 20, fontWeight: "900" },
  emptySub: { color: "#777", fontSize: 14 },
  card: { backgroundColor: "#111", borderRadius: 18, borderWidth: 1, borderColor: "#1a1a1a", marginBottom: 12, overflow: "hidden" },
  cardUser: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  cardUsername: { color: "#fff", fontSize: 15, fontWeight: "800" },
  cardGame: { color: "#8a8a8a", fontSize: 12, marginTop: 2 },
  cardScore: { color: "#06b6d4", fontSize: 22, fontWeight: "900" },
  photoPlaceholder: { marginHorizontal: 16, marginBottom: 14, borderRadius: 14, backgroundColor: "#0a0a0a", borderWidth: 1, borderColor: "#1a1a1a", height: 140, alignItems: "center", justifyContent: "center", gap: 6, position: "relative" },
  photoPlaceholderText: { color: "#333", fontSize: 13 },
  photoExpandHint: { position: "absolute", bottom: 8, right: 8, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  photoHintText: { color: "#fff", fontSize: 11 },
  cardActions: { flexDirection: "row", gap: 10, padding: 16, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a" },
  denyBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderRadius: 14, backgroundColor: "rgba(239,68,68,0.1)", borderWidth: 1, borderColor: "rgba(239,68,68,0.25)" },
  denyText: { color: "#ef4444", fontWeight: "800", fontSize: 15 },
  approveBtn: { flex: 1.6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderRadius: 14, backgroundColor: "#22c55e" },
  approveText: { color: "#000", fontWeight: "900", fontSize: 15 },
  sectionLabel: { color: "#6b6b6b", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 12 },
  healthRow: { flexDirection: "row", gap: 10 },
  healthCard: { flex: 1, backgroundColor: "#111", borderRadius: 16, padding: 16, alignItems: "center", gap: 4, borderWidth: 1, borderColor: "#1a1a1a" },
  healthValue: { fontSize: 26, fontWeight: "900" },
  healthLabel: { color: "#777", fontSize: 10, fontWeight: "700", textAlign: "center" },
});

// Profile
const pr = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingBottom: 32 },
  hero: { alignItems: "center", paddingVertical: 32, gap: 4 },
  cameraChip: { position: "absolute", bottom: 2, right: 2, width: 28, height: 28, borderRadius: 14, backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center", borderWidth: 2.5, borderColor: "#0a0a0a" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  heroName: { color: "#fff", fontSize: 26, fontWeight: "900" },
  heroEmail: { color: "#6b6b6b", fontSize: 13, marginTop: 2 },
  teamPill: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10, backgroundColor: "rgba(6,182,212,0.08)", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: "rgba(6,182,212,0.18)" },
  teamPillText: { color: "#06b6d4", fontWeight: "700", fontSize: 13 },
  sectionLabel: { color: "#6b6b6b", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 12 },
  featuredHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  changeBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(6,182,212,0.08)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: "rgba(6,182,212,0.18)" },
  changeBtnText: { color: "#06b6d4", fontSize: 12, fontWeight: "700" },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 22 },
  statBox: { flex: 1, backgroundColor: "#111", borderRadius: 18, padding: 16, alignItems: "center", gap: 4, borderWidth: 1, borderColor: "#1a1a1a" },
  statValue: { fontSize: 28, fontWeight: "900" },
  statLabel: { color: "#777", fontSize: 11 },
  pendingBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(245,158,11,0.08)", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "rgba(245,158,11,0.2)", marginBottom: 22 },
  pendingText: { color: "#f59e0b", fontWeight: "700", fontSize: 13, flex: 1 },
  scoresCard: { backgroundColor: "#111", borderRadius: 18, borderWidth: 1, borderColor: "#1a1a1a", overflow: "hidden", marginBottom: 28 },
  scoreRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  scoreRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  scoreGame: { color: "#fff", fontSize: 14, fontWeight: "700" },
  scoreTime: { color: "#777", fontSize: 11, marginTop: 2 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusApproved: { backgroundColor: "rgba(34,197,94,0.1)" },
  statusPending: { backgroundColor: "rgba(245,158,11,0.1)" },
  statusText: { fontSize: 11, fontWeight: "800" },
  scoreValue: { color: "#22c55e", fontSize: 17, fontWeight: "900", minWidth: 52, textAlign: "right" },
  actionsCard: { backgroundColor: "#111", borderRadius: 18, borderWidth: 1, borderColor: "#1a1a1a", overflow: "hidden", marginBottom: 16 },
  actionRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 15, gap: 14 },
  actionIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(6,182,212,0.08)", alignItems: "center", justifyContent: "center" },
  actionIconAmber: { backgroundColor: "rgba(245,158,11,0.08)" },
  actionLabel: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700" },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#1a1a1a", marginLeft: 64 },
  actionBadge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: "#f59e0b", alignItems: "center", justifyContent: "center", paddingHorizontal: 6, marginRight: 4 },
  actionBadgeText: { color: "#000", fontWeight: "900", fontSize: 12 },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(239,68,68,0.07)", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "rgba(239,68,68,0.18)" },
  logoutText: { color: "#ef4444", fontWeight: "800", fontSize: 15 },
});
