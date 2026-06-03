import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/avatar";
import BottomTabBar from "../components/bottom-tab-bar";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

type MainTab = "reviews" | "stats" | "health";
type ReviewTab = "pending" | "approved" | "denied";

type ReviewScore = {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  game_name: string;
  score: number;
  photo_url: string | null;
  created_at: string;
};

type ConfirmAction = {
  score: ReviewScore;
  toStatus: "approved" | "denied";
  title: string;
  body: string;
  btnLabel: string;
  btnColor: string;
  btnTextColor: string;
};

type StatsData = {
  pending: number;
  approved: number;
  denied: number;
  today: number;
  gameBreakdown: Array<{ type: string; label: string; count: number }>;
  topPlayers: Array<{ username: string; avatar_url: string | null; game_count: number; best_score: number }>;
};

type HealthData = {
  totalUsers: number;
  newUsersWeek: number;
  activePlayersWeek: number;
  scoresToday: number;
  pendingQueue: number;
  approvalRate: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_TABS: { key: MainTab; label: string; icon: string }[] = [
  { key: "reviews", label: "Reviews", icon: "checkmark-done-outline" },
  { key: "stats",   label: "Stats",   icon: "bar-chart-outline" },
  { key: "health",  label: "Health",  icon: "pulse-outline" },
];

const REVIEW_TABS: ReviewTab[] = ["pending", "approved", "denied"];

const REVIEW_EMPTY: Record<ReviewTab, { title: string; sub: string; icon: string; color: string }> = {
  pending:  { title: "All caught up!",      sub: "No pending scores to review.", icon: "checkmark-done-circle-outline", color: "#22c55e" },
  approved: { title: "Nothing approved yet", sub: "Approved scores appear here.", icon: "checkmark-circle-outline",      color: "#06b6d4" },
  denied:   { title: "No denied scores",     sub: "Denied scores appear here.",   icon: "close-circle-outline",           color: "#ef4444" },
};

const TYPE_LABELS: Record<string, string> = {
  skeeball:   "Skee-Ball",
  pinball:    "Pinball",
  arcade:     "Arcade",
  basketball: "Basketball",
  airhockey:  "Air Hockey",
  pool:       "Pool",
};

const TYPE_COLORS: Record<string, string> = {
  skeeball:   "#06b6d4",
  pinball:    "#a855f7",
  arcade:     "#f59e0b",
  basketball: "#ef4444",
  airhockey:  "#22c55e",
  pool:       "#3b82f6",
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AdminScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);

  // Main navigation
  const [mainTab, setMainTab] = useState<MainTab>("reviews");

  // Reviews state
  const [reviewTab, setReviewTab] = useState<ReviewTab>("pending");
  const [scores, setScores] = useState<ReviewScore[]>([]);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [reviewRefreshing, setReviewRefreshing] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [photoModal, setPhotoModal] = useState<string | null>(null);

  // Stats state
  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Health state
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  useEffect(() => { if (user) checkAdminAndLoad(); }, [user]);
  useEffect(() => { if (isAdmin) loadReviews(reviewTab); }, [reviewTab, isAdmin]);
  useEffect(() => {
    if (!isAdmin) return;
    if (mainTab === "stats" && !statsData) loadStats();
    if (mainTab === "health" && !healthData) loadHealth();
  }, [mainTab, isAdmin]);

  async function checkAdminAndLoad() {
    const { data } = await supabase.from("profiles").select("is_admin").eq("id", user!.id).single();
    if (!data?.is_admin) { router.replace("/"); return; }
    setIsAdmin(true);
    setChecking(false);
  }

  // ── Reviews ────────────────────────────────────────────────────────────────

  async function loadReviews(tab: ReviewTab) {
    setReviewLoading(true);
    const { data } = await supabase
      .from("scores")
      .select("id, user_id, score, photo_url, created_at, profiles(username, avatar_url), games(name)")
      .eq("status", tab)
      .order("created_at", { ascending: tab === "pending" });

    setScores((data ?? []).map((row: any) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      const game    = Array.isArray(row.games)    ? row.games[0]    : row.games;
      return {
        id: row.id, user_id: row.user_id,
        username:   profile?.username   ?? "Unknown",
        avatar_url: profile?.avatar_url ?? null,
        game_name:  game?.name          ?? "Unknown Game",
        score: row.score,
        photo_url:  row.photo_url       ?? null,
        created_at: row.created_at,
      };
    }));
    setReviewLoading(false);
    setReviewRefreshing(false);
  }

  async function handleDirectApprove(score: ReviewScore) {
    setReviewError(null);
    setActioning(score.id);
    const { error } = await supabase.from("scores").update({ status: "approved" }).eq("id", score.id);
    if (error) { setReviewError(error.message); }
    else { setScores((prev) => prev.filter((s) => s.id !== score.id)); }
    setActioning(null);
  }

  function requestConfirm(score: ReviewScore, action: "deny" | "revoke" | "reapprove") {
    const map = {
      deny:      { toStatus: "denied"    as const, title: "Deny this score?",      body: `Deny ${score.username}'s ${score.score.toLocaleString()} pts on ${score.game_name}?`,                                              btnLabel: "Deny",    btnColor: "#ef4444", btnTextColor: "#fff" },
      revoke:    { toStatus: "denied"    as const, title: "Revoke approval?",       body: `Remove ${score.username}'s ${score.score.toLocaleString()} pts (${score.game_name}) from the leaderboard?`,                       btnLabel: "Revoke",  btnColor: "#ef4444", btnTextColor: "#fff" },
      reapprove: { toStatus: "approved"  as const, title: "Re-approve this score?", body: `Restore ${score.username}'s ${score.score.toLocaleString()} pts on ${score.game_name} to the leaderboard?`, btnLabel: "Approve", btnColor: "#22c55e", btnTextColor: "#000" },
    };
    setConfirmAction({ score, ...map[action] });
  }

  async function executeConfirm() {
    if (!confirmAction) return;
    setReviewError(null);
    setActioning(confirmAction.score.id);
    const { error } = await supabase.from("scores").update({ status: confirmAction.toStatus }).eq("id", confirmAction.score.id);
    if (error) { setReviewError(error.message); }
    else { setScores((prev) => prev.filter((s) => s.id !== confirmAction.score.id)); }
    setActioning(null);
    setConfirmAction(null);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  async function loadStats() {
    setStatsLoading(true);
    const todayISO = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); })();

    const [pendingRes, approvedRes, deniedRes, todayRes, scoresRes] = await Promise.all([
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("status", "approved"),
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("status", "denied"),
      supabase.from("scores").select("id", { count: "exact", head: true }).gte("created_at", todayISO),
      supabase.from("scores").select("user_id, score, games(type)").eq("status", "approved").limit(1000),
    ]);

    // Game breakdown
    const typeCounts: Record<string, number> = {};
    (scoresRes.data ?? []).forEach((s: any) => {
      const g = Array.isArray(s.games) ? s.games[0] : s.games;
      const t = g?.type ?? "other";
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    });
    const total = Object.values(typeCounts).reduce((a, b) => a + b, 0) || 1;
    const gameBreakdown = Object.entries(typeCounts)
      .map(([type, count]) => ({ type, label: TYPE_LABELS[type] ?? type, count }))
      .sort((a, b) => b.count - a.count);

    // Top players
    const playerMap: Record<string, { count: number; best: number }> = {};
    (scoresRes.data ?? []).forEach((s: any) => {
      if (!playerMap[s.user_id]) playerMap[s.user_id] = { count: 0, best: 0 };
      playerMap[s.user_id].count++;
      if (s.score > playerMap[s.user_id].best) playerMap[s.user_id].best = s.score;
    });
    const topIds = Object.entries(playerMap).sort((a, b) => b[1].count - a[1].count).slice(0, 5).map(([id]) => id);
    let topPlayers: StatsData["topPlayers"] = [];
    if (topIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, username, avatar_url").in("id", topIds);
      topPlayers = topIds.map(id => {
        const p = profiles?.find((x: any) => x.id === id);
        return { username: p?.username ?? "Unknown", avatar_url: p?.avatar_url ?? null, game_count: playerMap[id].count, best_score: playerMap[id].best };
      });
    }

    setStatsData({ pending: pendingRes.count ?? 0, approved: approvedRes.count ?? 0, denied: deniedRes.count ?? 0, today: todayRes.count ?? 0, gameBreakdown, topPlayers });
    setStatsLoading(false);
  }

  // ── Health ─────────────────────────────────────────────────────────────────

  async function loadHealth() {
    setHealthLoading(true);
    const weekISO  = new Date(Date.now() - 7 * 86400000).toISOString();
    const todayISO = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); })();

    const [totalUsersRes, newUsersRes, scoresWeekRes, scoresTodayRes, pendingRes, approvedRes, deniedRes] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", weekISO),
      supabase.from("scores").select("user_id").gte("created_at", weekISO),
      supabase.from("scores").select("id", { count: "exact", head: true }).gte("created_at", todayISO),
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("status", "approved"),
      supabase.from("scores").select("id", { count: "exact", head: true }).eq("status", "denied"),
    ]);

    const activePlayersWeek = [...new Set((scoresWeekRes.data ?? []).map((s: any) => s.user_id))].length;
    const reviewed = (approvedRes.count ?? 0) + (deniedRes.count ?? 0);
    const approvalRate = reviewed > 0 ? Math.round(((approvedRes.count ?? 0) / reviewed) * 100) : 0;

    setHealthData({
      totalUsers: totalUsersRes.count ?? 0,
      newUsersWeek: newUsersRes.count ?? 0,
      activePlayersWeek,
      scoresToday: scoresTodayRes.count ?? 0,
      pendingQueue: pendingRes.count ?? 0,
      approvalRate,
    });
    setHealthLoading(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (authLoading || checking) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }
  if (!isAdmin) return null;

  return (
    <View style={styles.rootView}>
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/profile" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Admin Panel</Text>
          <Text style={styles.headerSub}>
            {mainTab === "reviews" ? "Score review queue" : mainTab === "stats" ? "Submission metrics" : "Business health"}
          </Text>
        </View>
        {mainTab === "reviews" && reviewTab === "pending" && scores.length > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{scores.length}</Text>
          </View>
        )}
      </View>

      {/* Main tab bar */}
      <View style={styles.mainTabBar}>
        {MAIN_TABS.map(({ key, label, icon }) => (
          <Pressable
            key={key}
            style={[styles.mainTabItem, mainTab === key && styles.mainTabItemActive]}
            onPress={() => setMainTab(key)}
          >
            <Ionicons name={icon as any} size={16} color={mainTab === key ? "#f59e0b" : "#444"} />
            <Text style={[styles.mainTabLabel, mainTab === key && styles.mainTabLabelActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── Reviews ── */}
      {mainTab === "reviews" && (
        <>
          <View style={styles.subTabBar}>
            {REVIEW_TABS.map((tab) => (
              <Pressable
                key={tab}
                style={[styles.subTabItem, reviewTab === tab && styles.subTabItemActive]}
                onPress={() => { setReviewError(null); setReviewTab(tab); }}
              >
                <Text style={[styles.subTabLabel, reviewTab === tab && styles.subTabLabelActive]}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={reviewRefreshing} onRefresh={() => { setReviewRefreshing(true); loadReviews(reviewTab); }} tintColor="#06b6d4" />}
          >
            {reviewLoading ? (
              <ActivityIndicator color="#06b6d4" style={{ marginTop: 60 }} />
            ) : scores.length === 0 ? (
              <EmptyState {...REVIEW_EMPTY[reviewTab]} />
            ) : (
              <>
                {reviewError && <ErrorBanner message={reviewError} />}
                {scores.map((item) => (
                  <ScoreCard
                    key={item.id}
                    item={item}
                    tab={reviewTab}
                    actioning={actioning === item.id}
                    onApprove={() => handleDirectApprove(item)}
                    onDeny={() => requestConfirm(item, "deny")}
                    onRevoke={() => requestConfirm(item, "revoke")}
                    onReApprove={() => requestConfirm(item, "reapprove")}
                    onPhotoPress={() => item.photo_url && setPhotoModal(item.photo_url)}
                  />
                ))}
              </>
            )}
          </ScrollView>
        </>
      )}

      {/* ── Stats ── */}
      {mainTab === "stats" && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => { setStatsData(null); loadStats(); }} tintColor="#f59e0b" />}
        >
          {statsLoading || !statsData ? (
            <ActivityIndicator color="#f59e0b" style={{ marginTop: 60 }} />
          ) : (
            <StatsSection data={statsData} />
          )}
        </ScrollView>
      )}

      {/* ── Health ── */}
      {mainTab === "health" && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => { setHealthData(null); loadHealth(); }} tintColor="#f59e0b" />}
        >
          {healthLoading || !healthData ? (
            <ActivityIndicator color="#f59e0b" style={{ marginTop: 60 }} />
          ) : (
            <HealthSection data={healthData} />
          )}
        </ScrollView>
      )}

      {/* Confirm modal */}
      <Modal visible={!!confirmAction} transparent animationType="fade" onRequestClose={() => setConfirmAction(null)}>
        <View style={styles.confirmBg}>
          <Pressable style={styles.confirmDismiss} onPress={() => setConfirmAction(null)} />
          <View style={styles.confirmSheet}>
            <View style={[styles.confirmIconWrap, { backgroundColor: (confirmAction?.btnColor ?? "#ef4444") + "15", borderColor: (confirmAction?.btnColor ?? "#ef4444") + "35" }]}>
              <Ionicons name={confirmAction?.toStatus === "approved" ? "checkmark-circle-outline" : "close-circle-outline"} size={40} color={confirmAction?.btnColor ?? "#ef4444"} />
            </View>
            <Text style={styles.confirmTitle}>{confirmAction?.title}</Text>
            <Text style={styles.confirmBody}>{confirmAction?.body}</Text>
            <View style={styles.confirmBtns}>
              <Pressable style={styles.confirmCancel} onPress={() => setConfirmAction(null)}>
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.confirmActionBtn, { backgroundColor: confirmAction?.btnColor ?? "#ef4444" }, !!actioning && { opacity: 0.5 }]} onPress={executeConfirm} disabled={!!actioning}>
                {actioning
                  ? <ActivityIndicator size="small" color={confirmAction?.btnTextColor ?? "#fff"} />
                  : <Text style={[styles.confirmActionText, { color: confirmAction?.btnTextColor ?? "#fff" }]}>{confirmAction?.btnLabel}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Photo modal */}
      <Modal visible={!!photoModal} transparent animationType="fade" onRequestClose={() => setPhotoModal(null)}>
        <Pressable style={styles.photoModalBg} onPress={() => setPhotoModal(null)}>
          <View style={styles.photoModalInner}>
            <View style={styles.photoModalHeader}>
              <Text style={styles.photoModalTitle}>Score Proof</Text>
              <Pressable onPress={() => setPhotoModal(null)}>
                <Ionicons name="close-circle" size={28} color="#555" />
              </Pressable>
            </View>
            {photoModal && <Image source={{ uri: photoModal }} style={styles.photoModalImage} contentFit="contain" cachePolicy="none" />}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
    <BottomTabBar />
    </View>
  );
}

// ─── Stats Section ─────────────────────────────────────────────────────────────

function StatsSection({ data }: { data: StatsData }) {
  const totalScores = data.pending + data.approved + data.denied || 1;

  return (
    <>
      {/* Score overview */}
      <SectionHeader title="Score Overview" />
      <View style={styles.statRow}>
        <StatCard label="Pending"  value={data.pending}  color="#f59e0b" />
        <StatCard label="Approved" value={data.approved} color="#22c55e" />
        <StatCard label="Denied"   value={data.denied}   color="#ef4444" />
      </View>
      <View style={[styles.card, { padding: 16, marginBottom: 20 }]}>
        <Text style={styles.cardLabel}>Submitted Today</Text>
        <Text style={styles.cardBigValue}>{data.today}</Text>
        <Text style={styles.cardSubLabel}>All-time total: {totalScores - 1}</Text>
      </View>

      {/* Game breakdown */}
      {data.gameBreakdown.length > 0 && (
        <>
          <SectionHeader title="By Game Type" />
          {data.gameBreakdown.map(({ type, label, count }) => {
            const pct = Math.round((count / (data.approved || 1)) * 100);
            const color = TYPE_COLORS[type] ?? "#555";
            return (
              <View key={type} style={[styles.card, { padding: 14, marginBottom: 8 }]}>
                <View style={styles.breakdownRow}>
                  <View style={[styles.breakdownDot, { backgroundColor: color }]} />
                  <Text style={styles.breakdownLabel}>{label}</Text>
                  <Text style={styles.breakdownCount}>{count}</Text>
                  <Text style={[styles.breakdownPct, { color }]}>{pct}%</Text>
                </View>
                <View style={styles.barBg}>
                  <View style={[styles.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
                </View>
              </View>
            );
          })}
        </>
      )}

      {/* Top players */}
      {data.topPlayers.length > 0 && (
        <>
          <SectionHeader title="Top Players" sub="by approved score count" />
          {data.topPlayers.map((p, i) => (
            <View key={p.username} style={[styles.card, styles.playerRow]}>
              <Text style={styles.playerRank}>#{i + 1}</Text>
              <Avatar uri={p.avatar_url} name={p.username} size={38} />
              <View style={{ flex: 1 }}>
                <Text style={styles.playerName}>{p.username}</Text>
                <Text style={styles.playerSub}>{p.game_count} games · best {p.best_score.toLocaleString()}</Text>
              </View>
              <Ionicons name="trophy" size={16} color={i === 0 ? "#f59e0b" : i === 1 ? "#94a3b8" : "#cd7c3e"} />
            </View>
          ))}
        </>
      )}
    </>
  );
}

// ─── Health Section ────────────────────────────────────────────────────────────

function HealthSection({ data }: { data: HealthData }) {
  return (
    <>
      <SectionHeader title="User Base" />
      <View style={styles.statRow}>
        <StatCard label="Total Users"   value={data.totalUsers}      color="#06b6d4" />
        <StatCard label="New (7 days)"  value={data.newUsersWeek}    color="#a855f7" />
      </View>
      <StatCard label="Active Players (last 7 days)" value={data.activePlayersWeek} color="#22c55e" wide />

      <SectionHeader title="Activity" />
      <View style={styles.statRow}>
        <StatCard label="Scores Today"   value={data.scoresToday}   color="#f59e0b" />
        <StatCard label="Pending Review" value={data.pendingQueue}  color={data.pendingQueue > 10 ? "#ef4444" : "#f59e0b"} />
      </View>

      <SectionHeader title="Review Quality" />
      <View style={[styles.card, { padding: 20, alignItems: "center", marginBottom: 8 }]}>
        <Text style={[styles.bigPct, { color: data.approvalRate >= 70 ? "#22c55e" : data.approvalRate >= 40 ? "#f59e0b" : "#ef4444" }]}>
          {data.approvalRate}%
        </Text>
        <Text style={styles.bigPctLabel}>Approval Rate</Text>
        <Text style={styles.bigPctSub}>of all reviewed scores have been approved</Text>
      </View>

      <View style={[styles.card, { padding: 16, marginBottom: 20 }]}>
        <View style={styles.healthHintRow}>
          <Ionicons name="information-circle-outline" size={16} color="#444" />
          <Text style={styles.healthHint}>Pull to refresh for latest data. Stats are based on approved scores only.</Text>
        </View>
      </View>
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {sub && <Text style={styles.sectionSub}>{sub}</Text>}
    </View>
  );
}

function StatCard({ label, value, color, wide }: { label: string; value: number; color: string; wide?: boolean }) {
  return (
    <View style={[styles.card, styles.statCard, wide && styles.statCardWide, { borderColor: color + "22" }]}>
      <Text style={[styles.statValue, { color }]}>{value.toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function EmptyState({ title, sub, icon, color }: { title: string; sub: string; icon: string; color: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: color + "10", borderColor: color + "30" }]}>
        <Ionicons name={icon as any} size={52} color={color} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{sub}</Text>
    </View>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.inlineError}>
      <Text style={styles.inlineErrorText}>{message}</Text>
    </View>
  );
}

function ScoreCard({ item, tab, actioning, onApprove, onDeny, onRevoke, onReApprove, onPhotoPress }: {
  item: ReviewScore; tab: ReviewTab; actioning: boolean;
  onApprove: () => void; onDeny: () => void; onRevoke: () => void; onReApprove: () => void; onPhotoPress: () => void;
}) {
  return (
    <View style={styles.card}>
      {tab !== "pending" && (
        <View style={[styles.statusBanner, { backgroundColor: tab === "approved" ? "rgba(34,197,94,0.07)" : "rgba(239,68,68,0.07)" }]}>
          <Ionicons name={tab === "approved" ? "checkmark-circle" : "close-circle"} size={12} color={tab === "approved" ? "#22c55e" : "#ef4444"} />
          <Text style={[styles.statusBannerText, { color: tab === "approved" ? "#22c55e" : "#ef4444" }]}>
            {tab === "approved" ? "Approved" : "Denied"}
          </Text>
        </View>
      )}
      <View style={styles.cardUser}>
        <Avatar uri={item.avatar_url} name={item.username} size={42} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardUsername}>{item.username}</Text>
          <Text style={styles.cardGame}>{item.game_name} · {relTime(item.created_at)}</Text>
        </View>
        <Text style={styles.cardScore}>{item.score.toLocaleString()}</Text>
      </View>

      {item.photo_url ? (
        <Pressable style={styles.photoWrap} onPress={onPhotoPress}>
          <Image source={{ uri: item.photo_url }} style={styles.photoThumb} contentFit="cover" cachePolicy="none" />
          <View style={styles.photoTapHint}>
            <Ionicons name="expand-outline" size={14} color="#fff" />
            <Text style={styles.photoTapText}>Tap to enlarge</Text>
          </View>
        </Pressable>
      ) : (
        <View style={styles.noPhoto}>
          <Ionicons name="image-outline" size={20} color="#333" />
          <Text style={styles.noPhotoText}>No photo attached</Text>
        </View>
      )}

      <View style={styles.cardActions}>
        {tab === "pending" && (
          <>
            <Pressable style={[styles.denyBtn, actioning && { opacity: 0.5 }]} onPress={onDeny} disabled={actioning}>
              {actioning ? <ActivityIndicator size="small" color="#ef4444" /> : <Ionicons name="close" size={18} color="#ef4444" />}
              <Text style={styles.denyBtnText}>Deny</Text>
            </Pressable>
            <Pressable style={[styles.approveBtn, actioning && { opacity: 0.5 }]} onPress={onApprove} disabled={actioning}>
              {actioning ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="checkmark" size={18} color="#000" />}
              <Text style={styles.approveBtnText}>Approve</Text>
            </Pressable>
          </>
        )}
        {tab === "approved" && (
          <Pressable style={[styles.revokeBtn, actioning && { opacity: 0.5 }]} onPress={onRevoke} disabled={actioning}>
            {actioning ? <ActivityIndicator size="small" color="#ef4444" /> : <Ionicons name="arrow-undo" size={16} color="#ef4444" />}
            <Text style={styles.revokeBtnText}>Revoke Approval</Text>
          </Pressable>
        )}
        {tab === "denied" && (
          <Pressable style={[styles.reApproveBtn, actioning && { opacity: 0.5 }]} onPress={onReApprove} disabled={actioning}>
            {actioning ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="arrow-undo" size={16} color="#000" />}
            <Text style={styles.reApproveBtnText}>Re-approve Score</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  rootView: { flex: 1, backgroundColor: "#080808" },
  safe:   { flex: 1 },
  loader: { flex: 1, backgroundColor: "#080808", alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub:   { color: "#444", fontSize: 12, marginTop: 1 },
  countBadge:  { minWidth: 28, height: 28, borderRadius: 14, backgroundColor: "#f59e0b", alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  countBadgeText: { color: "#000", fontWeight: "900", fontSize: 14 },

  // Main tabs (Reviews / Stats / Health)
  mainTabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
    paddingHorizontal: 16,
  },
  mainTabItem: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 13,
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  mainTabItemActive: { borderBottomColor: "#f59e0b" },
  mainTabLabel:      { color: "#444", fontSize: 13, fontWeight: "700" },
  mainTabLabelActive:{ color: "#f59e0b" },

  // Sub-tabs (Pending / Approved / Denied)
  subTabBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  subTabItem: {
    flex: 1, paddingVertical: 10, alignItems: "center",
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  subTabItemActive: { borderBottomColor: "#06b6d4" },
  subTabLabel:      { color: "#444", fontSize: 12, fontWeight: "700" },
  subTabLabelActive:{ color: "#06b6d4" },

  content: { padding: 16, paddingBottom: 40 },

  // Section headings inside stats/health
  sectionHeader: { marginTop: 8, marginBottom: 12 },
  sectionTitle:  { color: "#fff", fontSize: 16, fontWeight: "900" },
  sectionSub:    { color: "#444", fontSize: 12, marginTop: 2 },

  // Generic card
  card: {
    backgroundColor: "#111", borderRadius: 18,
    borderWidth: 1, borderColor: "#1e1e1e",
    marginBottom: 10, overflow: "hidden",
  },

  // Stat cards
  statRow:      { flexDirection: "row", gap: 10, marginBottom: 10 },
  statCard:     { flex: 1, padding: 16, alignItems: "center", gap: 4 },
  statCardWide: { flex: undefined, width: "100%", flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20 },
  statValue:    { fontSize: 28, fontWeight: "900" },
  statLabel:    { color: "#555", fontSize: 11, fontWeight: "700", textAlign: "center" },
  cardLabel:    { color: "#555", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
  cardBigValue: { color: "#fff", fontSize: 40, fontWeight: "900" },
  cardSubLabel: { color: "#333", fontSize: 12, marginTop: 4 },

  // Breakdown bars
  breakdownRow:  { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  breakdownDot:  { width: 8, height: 8, borderRadius: 4 },
  breakdownLabel:{ flex: 1, color: "#fff", fontSize: 14, fontWeight: "700" },
  breakdownCount:{ color: "#888", fontSize: 14, fontWeight: "700" },
  breakdownPct:  { fontSize: 13, fontWeight: "900", minWidth: 36, textAlign: "right" },
  barBg:         { height: 6, backgroundColor: "#1e1e1e", borderRadius: 3, overflow: "hidden" },
  barFill:       { height: 6, borderRadius: 3 },

  // Player rows
  playerRow:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  playerRank: { color: "#333", fontSize: 13, fontWeight: "900", minWidth: 24, textAlign: "center" },
  playerName: { color: "#fff", fontSize: 14, fontWeight: "800" },
  playerSub:  { color: "#444", fontSize: 12, marginTop: 1 },

  // Health big stat
  bigPct:      { fontSize: 56, fontWeight: "900", letterSpacing: -2 },
  bigPctLabel: { color: "#fff", fontSize: 16, fontWeight: "800", marginTop: 4 },
  bigPctSub:   { color: "#444", fontSize: 12, marginTop: 4, textAlign: "center" },
  healthHintRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  healthHint:  { color: "#444", fontSize: 12, lineHeight: 18, flex: 1 },

  // Empty & error
  emptyState: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyIcon:  { width: 88, height: 88, borderRadius: 44, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { color: "#fff", fontSize: 20, fontWeight: "900" },
  emptySub:   { color: "#444", fontSize: 14 },
  inlineError:     { backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },
  inlineErrorText: { color: "#ef4444", fontSize: 13 },

  // Score cards
  statusBanner:     { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  statusBannerText: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  cardUser:     { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  cardUsername: { color: "#fff", fontSize: 15, fontWeight: "800" },
  cardGame:     { color: "#555", fontSize: 12, marginTop: 2 },
  cardScore:    { color: "#06b6d4", fontSize: 22, fontWeight: "900" },
  photoWrap:    { marginHorizontal: 16, marginBottom: 14, borderRadius: 14, overflow: "hidden" },
  photoThumb:   { width: "100%", height: 180 },
  photoTapHint: { position: "absolute", bottom: 8, right: 8, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  photoTapText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  noPhoto:      { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 14, backgroundColor: "#0a0a0a", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#1a1a1a" },
  noPhotoText:  { color: "#333", fontSize: 13 },
  cardActions:  { flexDirection: "row", gap: 10, padding: 16, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a" },

  denyBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderRadius: 14, backgroundColor: "rgba(239,68,68,0.1)", borderWidth: 1, borderColor: "rgba(239,68,68,0.25)" },
  denyBtnText: { color: "#ef4444", fontWeight: "800", fontSize: 15 },
  approveBtn:     { flex: 1.6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderRadius: 14, backgroundColor: "#22c55e" },
  approveBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },
  revokeBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: 14, backgroundColor: "rgba(239,68,68,0.08)", borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },
  revokeBtnText: { color: "#ef4444", fontWeight: "800", fontSize: 15 },
  reApproveBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: 14, backgroundColor: "#22c55e" },
  reApproveBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },

  // Confirm modal
  confirmBg:       { flex: 1, backgroundColor: "rgba(0,0,0,0.82)", justifyContent: "center", padding: 24 },
  confirmDismiss:  { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  confirmSheet:    { backgroundColor: "#111", borderRadius: 28, padding: 28, alignItems: "center", borderWidth: 1, borderColor: "#1e1e1e" },
  confirmIconWrap: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  confirmTitle:    { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 8, textAlign: "center" },
  confirmBody:     { color: "#555", fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 24 },
  confirmBtns:     { flexDirection: "row", gap: 10, width: "100%" },
  confirmCancel:   { flex: 1, backgroundColor: "#1a1a1a", borderRadius: 14, padding: 15, alignItems: "center" },
  confirmCancelText:  { color: "#888", fontWeight: "700" },
  confirmActionBtn:   { flex: 1, borderRadius: 14, padding: 15, alignItems: "center" },
  confirmActionText:  { fontWeight: "900" },

  // Photo modal
  photoModalBg:     { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center", padding: 20 },
  photoModalInner:  { backgroundColor: "#111", borderRadius: 24, borderWidth: 1, borderColor: "#1e1e1e", overflow: "hidden" },
  photoModalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e1e1e" },
  photoModalTitle:  { color: "#fff", fontSize: 16, fontWeight: "800" },
  photoModalImage:  { width: "100%", height: 420 },
});
