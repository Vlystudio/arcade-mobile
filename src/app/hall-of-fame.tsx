import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Head from "expo-router/head";
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
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";
import { openUserProfile, openUserProfileByName } from "../lib/open-profile";

type PlayerRecord = { username: string; avatar_url: string | null; value: number; week_of?: string } | null;
type TeamRecord = { team_name: string; value: number; week_of?: string } | null;

type HallOfFame = {
  highest_game: PlayerRecord;
  best_week_avg: PlayerRecord;
  most_hundos: PlayerRecord;
  longest_streak: PlayerRecord;
  team_highest_game: TeamRecord;
  team_most_points: TeamRecord;
};

export default function HallOfFameScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [hof, setHof] = useState<HallOfFame | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const { data } = await supabase.rpc("rpc_skeeball_hall_of_fame");
    if (data && !(data as any).error) setHof(data as HallOfFame);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { if (user) load(); }, [user]);

  if (authLoading || loading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#f59e0b" /></View>;
  }

  const fmtWeek = (iso?: string) =>
    iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

  const records: { icon: string; title: string; player?: PlayerRecord; team?: TeamRecord; unit: string }[] = [
    { icon: "flame", title: "Highest Game Ever", player: hof?.highest_game ?? null, unit: "pts" },
    { icon: "trending-up", title: "Best Week Average", player: hof?.best_week_avg ?? null, unit: "avg" },
    { icon: "radio-button-on", title: "Most Career Hundos", player: hof?.most_hundos ?? null, unit: "hundos" },
    { icon: "flash", title: "Longest Hundo Streak", player: hof?.longest_streak ?? null, unit: "in a row" },
    { icon: "people", title: "Highest Team Game", team: hof?.team_highest_game ?? null, unit: "pts" },
    { icon: "trophy", title: "Most League Points (All-Time)", team: hof?.team_most_points ?? null, unit: "pts" },
  ];

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Head><title>Hall of Fame · ArcadeTracker</title></Head>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/leagues" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>🏆 Hall of Fame</Text>
          <Text style={s.headerSub}>All-time skee-ball league records</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#f59e0b" />}
      >
        {records.every((r) => !r.player && !r.team) ? (
          <View style={s.empty}>
            <Ionicons name="trophy-outline" size={44} color="#333" />
            <Text style={s.emptyTitle}>Records await</Text>
            <Text style={s.emptySub}>Play league games and your name could live here forever.</Text>
          </View>
        ) : (
          records.map((r) => {
            const holder = r.player?.username ?? r.team?.team_name;
            const value = r.player?.value ?? r.team?.value;
            const week = fmtWeek(r.player?.week_of ?? r.team?.week_of);
            if (!holder) return null;
            return (
              <View key={r.title} style={s.recordCard}>
                <View style={s.recordIcon}>
                  <Ionicons name={r.icon as any} size={20} color="#f59e0b" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.recordTitle}>{r.title}</Text>
                  <Pressable
                    style={s.holderRow}
                    onPress={() => r.player && openUserProfileByName(holder)}
                    disabled={!r.player}
                  >
                    {r.player && <Avatar uri={r.player.avatar_url} name={holder} size={24} />}
                    <Text style={s.holderName}>{holder}</Text>
                  </Pressable>
                  {week && <Text style={s.recordWeek}>{week}</Text>}
                </View>
                <View style={s.valueWrap}>
                  <Text style={s.valueNum}>{value}</Text>
                  <Text style={s.valueUnit}>{r.unit}</Text>
                </View>
              </View>
            );
          })
        )}
        <Text style={s.note}>Records update automatically as league games are played.</Text>
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "#777", fontSize: 12, marginTop: 1 },
  content: { paddingHorizontal: 18, paddingTop: 18 },

  recordCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "rgba(245,158,11,0.04)", borderRadius: 18, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.18)",
  },
  recordIcon: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: "rgba(245,158,11,0.1)", alignItems: "center", justifyContent: "center",
  },
  recordTitle: { color: "#f59e0b", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  holderRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 4 },
  holderName: { color: "#fff", fontSize: 16, fontWeight: "900" },
  recordWeek: { color: "#777", fontSize: 11.5, marginTop: 2 },
  valueWrap: { alignItems: "flex-end" },
  valueNum: { color: "#fff", fontSize: 26, fontWeight: "900", letterSpacing: -0.5 },
  valueUnit: { color: "#777", fontSize: 10.5, fontWeight: "700" },

  empty: { alignItems: "center", gap: 10, paddingVertical: 72, paddingHorizontal: 32 },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  emptySub: { color: "#8a8a8a", fontSize: 13.5, textAlign: "center", lineHeight: 19 },
  note: { color: "#6e6e6e", fontSize: 11.5, textAlign: "center", marginTop: 8 },
});
