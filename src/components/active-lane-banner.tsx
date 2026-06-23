import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/auth-context";

/**
 * If the current user's team has a skee-ball session in progress, show a
 * tappable "Rejoin Lane X" banner. Skee-ball sessions are team-wide, so any
 * teammate can pick scoring up where it left off — this just makes that
 * obvious from the app's entry points instead of needing to re-scan.
 * Renders nothing when there's no live session. Safe to drop anywhere.
 */
export function ActiveLaneBanner() {
  const { user } = useAuth();
  const [live, setLive] = useState<{ lane: number; teamId: string; teamName: string } | null>(null);

  useEffect(() => {
    if (!user) { setLive(null); return; }
    let cancelled = false;

    async function check() {
      const { data: tm } = await supabase
        .from("team_members").select("team_id, teams(name)").eq("user_id", user!.id).maybeSingle();
      const teamId = (tm as any)?.team_id as string | undefined;
      if (!teamId) { if (!cancelled) setLive(null); return; }
      const teamName = Array.isArray((tm as any).teams) ? (tm as any).teams[0]?.name : (tm as any).teams?.name;
      const { data: s } = await supabase
        .from("skeeball_sessions").select("lane_number")
        .eq("team_id", teamId).eq("status", "active")
        .order("last_activity_at", { ascending: false }).limit(1).maybeSingle();
      if (cancelled) return;
      setLive(s ? { lane: (s as any).lane_number, teamId, teamName: teamName ?? "your team" } : null);
    }

    check();
    const t = setInterval(check, 30000); // keep fresh during league night
    return () => { cancelled = true; clearInterval(t); };
  }, [user?.id]);

  if (!live) return null;

  return (
    <Pressable
      style={s.banner}
      onPress={() => router.push(`/skeeball-tracker?teamId=${live.teamId}&teamName=${encodeURIComponent(live.teamName)}` as any)}
    >
      <View style={s.dot} />
      <View style={{ flex: 1 }}>
        <Text style={s.title}>Live on Lane {live.lane}</Text>
        <Text style={s.sub}>{live.teamName} has a game in progress — tap to rejoin scoring</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#06b6d4" />
    </Pressable>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(6,182,212,0.08)", borderColor: "rgba(6,182,212,0.3)", borderWidth: 1,
    borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 12,
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#ef4444" },
  title: { color: "#fff", fontSize: 14.5, fontWeight: "800" },
  sub: { color: "#7a9aa3", fontSize: 12, marginTop: 1 },
});
