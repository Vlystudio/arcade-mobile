import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/avatar";
import { supabase } from "../../lib/supabase";
import { openUserProfile } from "../lib/open-profile";

type ScoreEntry = {
  id: string;
  score: number;
  created_at: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
};

export default function LaneScoresScreen() {
  const { lane_id, lane_number } = useLocalSearchParams<{ lane_id: string; lane_number: string }>();
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadScores() {
    if (!lane_id) return;

    const { data: scoresData, error } = await supabase
      .from("scores")
      .select("id, score, created_at, user_id")
      .eq("lane_id", lane_id)
      .eq("status", "approved")
      .order("score", { ascending: false })
      .limit(100);

    if (error || !scoresData?.length) {
      setScores([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const userIds = [...new Set(scoresData.map((s) => s.user_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .in("id", userIds);

    const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));

    setScores(
      scoresData.map((s) => ({
        id: s.id,
        score: s.score,
        created_at: s.created_at,
        user_id: s.user_id,
        username: profileMap[s.user_id]?.username ?? "Player",
        avatar_url: profileMap[s.user_id]?.avatar_url ?? null,
      }))
    );
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { loadScores(); }, [lane_id]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/games" as any)}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Lane {lane_number}</Text>
            <Text style={styles.headerSub}>Skee-Ball · Top 100 All-Time</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadScores(); }} tintColor="#06b6d4" />
          }
          contentContainerStyle={scores.length === 0 && !loading ? styles.emptyContainer : styles.listContainer}
        >
          {loading ? (
            <ActivityIndicator size="large" color="#06b6d4" style={{ marginTop: 60 }} />
          ) : scores.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name="trophy-outline" size={40} color="#333" />
              </View>
              <Text style={styles.emptyTitle}>No scores yet</Text>
              <Text style={styles.emptySub}>Play Lane {lane_number} and be the first on the board!</Text>
            </View>
          ) : (
            <>
              {/* Top 3 podium */}
              {scores.length >= 1 && (
                <View style={styles.podium}>
                  {scores.slice(0, 3).map((entry, i) => (
                    <PodiumCard key={entry.id} entry={entry} rank={i + 1} />
                  ))}
                </View>
              )}

              {/* Ranks 4–100 */}
              {scores.slice(3).map((entry, i) => (
                <ScoreRow key={entry.id} entry={entry} rank={i + 4} />
              ))}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function PodiumCard({ entry, rank }: { entry: ScoreEntry; rank: number }) {
  const medal = rank === 1 ? "#f59e0b" : rank === 2 ? "#94a3b8" : "#cd7c3e";
  const medalIcon = rank === 1 ? "trophy" : "medal-outline";
  const size = rank === 1 ? 1.1 : 1;

  return (
    <View style={[styles.podiumCard, rank === 1 && styles.podiumCardFirst, { borderColor: medal + "40" }]}>
      <View style={[styles.podiumMedalWrap, { backgroundColor: medal + "18" }]}>
        <Ionicons name={medalIcon as any} size={20 * size} color={medal} />
      </View>
      <Text style={[styles.podiumRank, { color: medal }]}>#{rank}</Text>
      <Pressable onPress={() => openUserProfile(entry.user_id)}>
        <Avatar uri={entry.avatar_url} name={entry.username} size={rank === 1 ? 52 : 44} />
      </Pressable>
      <Text style={styles.podiumName} numberOfLines={1}>{entry.username}</Text>
      <Text style={[styles.podiumScore, { color: medal }]}>{entry.score.toLocaleString()}</Text>
      <Text style={styles.podiumDate}>{relDate(entry.created_at)}</Text>
    </View>
  );
}

function ScoreRow({ entry, rank }: { entry: ScoreEntry; rank: number }) {
  const isTop10 = rank <= 10;
  return (
    <View style={[styles.row, isTop10 && styles.rowTop10]}>
      <Text style={[styles.rowRank, isTop10 && styles.rowRankTop10]}>#{rank}</Text>
      <Pressable onPress={() => openUserProfile(entry.user_id)}>
        <Avatar uri={entry.avatar_url} name={entry.username} size={36} />
      </Pressable>
      <Text style={styles.rowName} numberOfLines={1}>{entry.username}</Text>
      <View style={styles.rowRight}>
        <Text style={[styles.rowScore, isTop10 && styles.rowScoreTop10]}>
          {entry.score.toLocaleString()}
        </Text>
        <Text style={styles.rowDate}>{relDate(entry.created_at)}</Text>
      </View>
    </View>
  );
}

function relDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },
  safe: { flex: 1 },

  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "#777", fontSize: 12, marginTop: 2 },

  listContainer: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 40 },
  emptyContainer: { flex: 1, paddingHorizontal: 18 },

  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 80 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "#141414", borderWidth: 1, borderColor: "#222",
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { color: "#fff", fontSize: 20, fontWeight: "900" },
  emptySub: { color: "#8a8a8a", fontSize: 14, textAlign: "center", lineHeight: 20 },

  // Podium (top 3)
  podium: { flexDirection: "row", gap: 10, marginBottom: 24 },
  podiumCard: {
    flex: 1, backgroundColor: "#111", borderRadius: 20,
    alignItems: "center", padding: 14, gap: 6,
    borderWidth: 1,
  },
  podiumCardFirst: { backgroundColor: "rgba(245,158,11,0.05)" },
  podiumMedalWrap: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center", marginBottom: 2,
  },
  podiumRank: { fontSize: 11, fontWeight: "900", letterSpacing: 0.5 },
  podiumName: { color: "#fff", fontSize: 12, fontWeight: "800", textAlign: "center" },
  podiumScore: { fontSize: 18, fontWeight: "900", letterSpacing: -0.5 },
  podiumDate: { color: "#777", fontSize: 10 },

  // Rows 4–100
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 16, marginBottom: 6,
    backgroundColor: "#111", borderWidth: 1, borderColor: "#1a1a1a",
  },
  rowTop10: { backgroundColor: "#131313", borderColor: "#222" },
  rowRank: { color: "#333", fontSize: 13, fontWeight: "900", minWidth: 30, textAlign: "center" },
  rowRankTop10: { color: "#06b6d4" },
  rowName: { flex: 1, color: "#fff", fontSize: 14, fontWeight: "700" },
  rowRight: { alignItems: "flex-end", gap: 2 },
  rowScore: { color: "#888", fontSize: 16, fontWeight: "900" },
  rowScoreTop10: { color: "#fff" },
  rowDate: { color: "#333", fontSize: 11 },
});
