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
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

type ScheduleRow = {
  team_id: string;
  team_name: string;
  slot_time: string;
  week_of: string;
  week_label: string | null;
};

type WeekOption = { week_of: string; week_label: string | null };

function currentMonday(): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function slotMinutes(slot: string): number {
  // "6:00 PM" → minutes since midnight, for chronological slot ordering
  const m = slot.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return 9999;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return h * 60 + parseInt(m[2], 10);
}

function fmtWeek(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function SkeeballScheduleScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [weeks, setWeeks] = useState<WeekOption[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [myTeamIds, setMyTeamIds] = useState<Set<string>>(new Set());
  const [placements, setPlacements] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(weekOverride?: string) {
    if (!user) return;
    const [schedRes, myTeamsRes] = await Promise.all([
      supabase
        .from("team_schedule")
        .select("team_id, slot_time, week_of, week_label, teams(name)")
        .not("week_of", "is", null)
        .order("week_of", { ascending: false }),
      supabase.from("team_members").select("team_id").eq("user_id", user.id),
    ]);

    setMyTeamIds(new Set((myTeamsRes.data ?? []).map((m: any) => m.team_id)));

    const all: ScheduleRow[] = (schedRes.data ?? []).map((r: any) => ({
      team_id: r.team_id,
      team_name: (Array.isArray(r.teams) ? r.teams[0]?.name : r.teams?.name) ?? "Unknown",
      slot_time: r.slot_time,
      week_of: r.week_of,
      week_label: r.week_label ?? null,
    }));
    setRows(all);

    // Distinct weeks, newest first
    const seen = new Map<string, string | null>();
    for (const r of all) if (!seen.has(r.week_of)) seen.set(r.week_of, r.week_label);
    const weekList = [...seen.entries()].map(([week_of, week_label]) => ({ week_of, week_label }));
    setWeeks(weekList);

    // Default: this week if scheduled, otherwise the most recent week
    const monday = currentMonday();
    const target = weekOverride
      ?? selectedWeek
      ?? (seen.has(monday) ? monday : weekList[0]?.week_of ?? null);
    setSelectedWeek(target);

    // Results for the selected week (medals once the round finalizes)
    if (target) {
      const { data: sess } = await supabase
        .from("skeeball_sessions")
        .select("team_id, placement")
        .eq("week_of", target)
        .eq("status", "completed");
      const map: Record<string, number> = {};
      for (const s of sess ?? []) {
        if ((s as any).placement != null) map[(s as any).team_id] = (s as any).placement;
      }
      setPlacements(map);
    } else {
      setPlacements({});
    }

    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { if (user) load(); }, [user]);

  async function pickWeek(weekOf: string) {
    setSelectedWeek(weekOf);
    const { data: sess } = await supabase
      .from("skeeball_sessions")
      .select("team_id, placement")
      .eq("week_of", weekOf)
      .eq("status", "completed");
    const map: Record<string, number> = {};
    for (const s of sess ?? []) {
      if ((s as any).placement != null) map[(s as any).team_id] = (s as any).placement;
    }
    setPlacements(map);
  }

  if (authLoading || loading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  const weekRows = rows.filter((r) => r.week_of === selectedWeek);
  const slots = [...new Set(weekRows.map((r) => r.slot_time))].sort((a, b) => slotMinutes(a) - slotMinutes(b));
  const isCurrentWeek = selectedWeek === currentMonday();
  const selectedLabel = weeks.find((w) => w.week_of === selectedWeek)?.week_label;

  const medal = (p?: number) =>
    p === 1 ? "🥇" : p === 2 ? "🥈" : p === 3 ? "🥉" : p != null ? `${p}th` : null;

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Head><title>Schedule · ArcadeTracker</title></Head>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/leagues" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Monday Night Schedule</Text>
          <Text style={s.headerSub}>Who plays when, every week</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#06b6d4" />}
      >
        {weeks.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="calendar-outline" size={42} color="#333" />
            <Text style={s.emptyTitle}>No schedule yet</Text>
            <Text style={s.emptySub}>The weekly schedule appears here once an admin sets the time slots.</Text>
          </View>
        ) : (
          <>
            {/* Week picker */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 18 }} contentContainerStyle={s.weekRow}>
              {weeks.map((w) => {
                const active = w.week_of === selectedWeek;
                const isThisWeek = w.week_of === currentMonday();
                return (
                  <Pressable
                    key={w.week_of}
                    style={[s.weekChip, active && s.weekChipActive]}
                    onPress={() => pickWeek(w.week_of)}
                  >
                    {isThisWeek && <View style={s.liveDot} />}
                    <Text style={[s.weekChipText, active && s.weekChipTextActive]}>
                      {isThisWeek ? "This Week" : w.week_label || fmtWeek(w.week_of)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Selected week heading */}
            <View style={s.weekHeading}>
              <Text style={s.weekHeadingText}>
                Monday, {new Date(selectedWeek!).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </Text>
              {selectedLabel ? <Text style={s.weekHeadingLabel}>{selectedLabel}</Text> : null}
              {isCurrentWeek && (
                <Pressable style={s.liveLink} onPress={() => router.push("/skeeball-live" as any)}>
                  <Ionicons name="radio-outline" size={13} color="#ef4444" />
                  <Text style={s.liveLinkText}>Watch Live</Text>
                </Pressable>
              )}
            </View>

            {weekRows.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptySub}>No teams scheduled for this week.</Text>
              </View>
            ) : (
              slots.map((slot) => {
                const teams = weekRows.filter((r) => r.slot_time === slot);
                return (
                  <View key={slot} style={s.slotSection}>
                    <View style={s.slotHeader}>
                      <View style={s.slotTimeWrap}>
                        <Ionicons name="time-outline" size={15} color="#06b6d4" />
                        <Text style={s.slotTime}>{slot}</Text>
                      </View>
                      <Text style={s.slotCount}>{teams.length} {teams.length === 1 ? "team" : "teams"}</Text>
                    </View>
                    {teams.map((t) => {
                      const mine = myTeamIds.has(t.team_id);
                      const place = medal(placements[t.team_id]);
                      return (
                        <Pressable
                          key={t.team_id}
                          style={[s.teamRow, mine && s.teamRowMine]}
                          onPress={() => router.push({ pathname: "/team-detail" as any, params: { teamId: t.team_id, teamName: t.team_name } })}
                        >
                          <View style={s.teamAvatar}>
                            <Text style={s.teamAvatarText}>{t.team_name.slice(0, 2).toUpperCase()}</Text>
                          </View>
                          <Text style={s.teamName} numberOfLines={1}>{t.team_name}</Text>
                          {mine && <View style={s.youBadge}><Text style={s.youBadgeText}>YOU</Text></View>}
                          {place && <Text style={s.placeText}>{place}</Text>}
                          <Ionicons name="chevron-forward" size={14} color="#333" />
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })
            )}
          </>
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 18, paddingTop: 16 },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  headerSub: { color: "#777", fontSize: 12, marginTop: 1 },

  weekRow: { gap: 8, alignItems: "center" },
  weekChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#111", borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  weekChipActive: { borderColor: "rgba(6,182,212,0.4)", backgroundColor: "rgba(6,182,212,0.08)" },
  weekChipText: { color: "#8a8a8a", fontSize: 13, fontWeight: "600" },
  weekChipTextActive: { color: "#06b6d4", fontWeight: "800" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e" },

  weekHeading: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" },
  weekHeadingText: { color: "#fff", fontSize: 15, fontWeight: "800", flexShrink: 1 },
  weekHeadingLabel: { color: "#777", fontSize: 12 },
  liveLink: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 9,
    paddingHorizontal: 9, paddingVertical: 5,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.25)", marginLeft: "auto",
  },
  liveLinkText: { color: "#ef4444", fontSize: 11.5, fontWeight: "800" },

  slotSection: {
    backgroundColor: "#0d0d0d", borderRadius: 18, marginBottom: 14,
    borderWidth: 1, borderColor: "#1a1a1a", overflow: "hidden",
  },
  slotHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: "#111",
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e1e1e",
  },
  slotTimeWrap: { flexDirection: "row", alignItems: "center", gap: 7 },
  slotTime: { color: "#06b6d4", fontSize: 16, fontWeight: "900", letterSpacing: -0.3 },
  slotCount: { color: "#777", fontSize: 12, fontWeight: "600" },

  teamRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#161616",
  },
  teamRowMine: { backgroundColor: "rgba(6,182,212,0.05)" },
  teamAvatar: {
    width: 34, height: 34, borderRadius: 11,
    backgroundColor: "rgba(6,182,212,0.1)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(6,182,212,0.18)",
  },
  teamAvatarText: { color: "#06b6d4", fontSize: 12, fontWeight: "900" },
  teamName: { flex: 1, color: "#fff", fontSize: 14.5, fontWeight: "800" },
  youBadge: { backgroundColor: "rgba(6,182,212,0.15)", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  youBadgeText: { color: "#06b6d4", fontSize: 9, fontWeight: "900" },
  placeText: { fontSize: 16 },

  empty: { alignItems: "center", gap: 10, paddingVertical: 56, paddingHorizontal: 32 },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  emptySub: { color: "#8a8a8a", fontSize: 13.5, textAlign: "center", lineHeight: 19 },
});
