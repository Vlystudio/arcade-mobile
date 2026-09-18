import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { PressableScale as Pressable } from "./pressable-scale";
import { showToast } from "./toast";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/auth-context";
import { Avatar } from "./avatar";
import { haptic } from "../../lib/haptics";
import { nextLeagueMonday } from "../../lib/experience";
import { publicProfilesById } from "../../lib/public-profiles";

type Member = { user_id: string; username: string; avatar_url: string | null; status: string | null };
type Data = {
  has_team: boolean;
  team_id?: string;
  team_name?: string;
  my_status?: string | null;
  members?: Member[];
  counts?: { in: number; out: number; maybe: number; total: number };
};

const OPTIONS: { key: "in" | "maybe" | "out"; label: string; icon: keyof typeof import("@expo/vector-icons/Ionicons").default.glyphMap; color: string }[] = [
  { key: "in", label: "I'm in", icon: "checkmark-circle", color: "#22c55e" },
  { key: "maybe", label: "Maybe", icon: "help-circle", color: "#f59e0b" },
  { key: "out", label: "Can't", icon: "close-circle", color: "#ef4444" },
];

/**
 * "You in for Monday?" — one-tap league-night RSVP for the user's team, with a
 * live count of who's confirmed. Renders nothing if the user isn't on a team.
 */
export function LeagueRsvpCard({ weekOf = nextLeagueMonday(), teamId }: { weekOf?: string; teamId?: string } = {}) {
  const { user } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [saving, setSaving] = useState(false);

  const userId = user?.id;
  const load = useCallback(async (): Promise<Data> => {
    if (!userId) return { has_team: false };
    let query = supabase.from("team_members").select("team_id, teams(name)").eq("user_id", userId).order("team_id").limit(1);
    if (teamId) query = query.eq("team_id", teamId);
    const membership = await query.maybeSingle();
    if (membership.error) throw membership.error;
    if (!membership.data) return { has_team: false };
    const id = membership.data.team_id;
    const [members, rsvps] = await Promise.all([
      supabase.from("team_members").select("user_id").eq("team_id", id),
      supabase.from("league_rsvps").select("user_id, status").eq("team_id", id).eq("week_of", weekOf),
    ]);
    if (members.error || rsvps.error) throw members.error ?? rsvps.error;
    const profiles = await publicProfilesById((members.data ?? []).map(m => m.user_id));
    const people = (members.data ?? []).map(m => ({ user_id: m.user_id, username: profiles.get(m.user_id)?.username ?? "Teammate", avatar_url: profiles.get(m.user_id)?.avatar_url ?? null, status: rsvps.data?.find(r => r.user_id === m.user_id)?.status ?? null }));
    const team = membership.data.teams as { name?: string } | { name?: string }[] | null;
    return { has_team: true, team_id: id, team_name: (Array.isArray(team) ? team[0]?.name : team?.name) ?? "Your team", my_status: people.find(p => p.user_id === userId)?.status, members: people, counts: { in: people.filter(p => p.status === "in").length, out: people.filter(p => p.status === "out").length, maybe: people.filter(p => p.status === "maybe").length, total: people.length } };
  }, [userId, teamId, weekOf]);
  useFocusEffect(useCallback(() => {
    let active = true;
    void load().then(next => { if (active) setData(next); }).catch(() => { if (active) setData(null); });
    return () => { active = false; };
  }, [load]));

  async function setStatus(status: "in" | "maybe" | "out") {
    if (saving || !data?.team_id || !userId) return;
    haptic(status === "in" ? "success" : "tap");
    setSaving(true);
    setData((d) => (d ? { ...d, my_status: status } : d)); // optimistic
    const previous = data;
    try {
      const result = await supabase.from("league_rsvps").upsert({ user_id: userId, team_id: data.team_id, week_of: weekOf, status, updated_at: new Date().toISOString() }, { onConflict: "user_id,week_of" });
      if (result.error) throw result.error;
      setData(await load());
      showToast("Your RSVP is saved.", "success");
    } catch {
      setData(previous);
      showToast("Your RSVP wasn’t saved. Please try again.", "error");
    } finally { setSaving(false); }
  }

  if (!data?.has_team) return null;
  const ins = (data.members ?? []).filter((m) => m.status === "in");
  const c = data.counts ?? { in: 0, out: 0, maybe: 0, total: 0 };

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <Ionicons name="calendar" size={15} color="#06b6d4" />
        <Text style={s.title}>{new Date(`${weekOf}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · You in?</Text>
        <Text style={s.count}>{c.in}/{c.total} in</Text>
      </View>

      <View style={s.optionsRow}>
        {OPTIONS.map((o) => {
          const active = data.my_status === o.key;
          return (
            <Pressable
              key={o.key}
              accessibilityLabel={`RSVP: ${o.label}`}
              accessibilityState={{ selected: active, disabled: saving }}
              style={[s.option, active && { backgroundColor: o.color + "22", borderColor: o.color }]}
              onPress={() => setStatus(o.key)}
              disabled={saving}
            >
              <Ionicons name={o.icon} size={16} color={active ? o.color : "#777"} />
              <Text style={[s.optionText, active && { color: o.color }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {ins.length > 0 && (
        <View style={s.avatarRow}>
          {ins.slice(0, 8).map((m) => (
            <Avatar key={m.user_id} uri={m.avatar_url} name={m.username} size={24} radius={8} />
          ))}
          <Text style={s.avatarHint}>{ins.length === 1 ? `${ins[0].username} is in` : `${ins.length} confirmed`}</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "#0d0d0d", borderColor: "#1c1c1c", borderWidth: 1, borderRadius: 16,
    padding: 14, marginBottom: 12,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  title: { color: "#fff", fontSize: 14.5, fontWeight: "800", flex: 1 },
  count: { color: "#06b6d4", fontSize: 12.5, fontWeight: "800" },
  optionsRow: { flexDirection: "row", gap: 8 },
  option: {
    minHeight: 48,
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderColor: "#262626", borderWidth: 1, borderRadius: 12, paddingVertical: 10, backgroundColor: "#0a0a0a",
  },
  optionText: { color: "#9a9a9a", fontSize: 13, fontWeight: "800" },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12 },
  avatarHint: { color: "#7a7a7a", fontSize: 12, fontWeight: "600", marginLeft: 6 },
});
