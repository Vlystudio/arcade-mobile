import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/auth-context";
import { Avatar } from "./avatar";
import { haptic } from "../../lib/haptics";

type Member = { user_id: string; username: string; avatar_url: string | null; status: string | null };
type Data = {
  has_team: boolean;
  team_name?: string;
  my_status?: string | null;
  members?: Member[];
  counts?: { in: number; out: number; maybe: number; total: number };
};

const OPTIONS: { key: "in" | "maybe" | "out"; label: string; icon: keyof typeof import("@expo/vector-icons").Ionicons.glyphMap; color: string }[] = [
  { key: "in", label: "I'm in", icon: "checkmark-circle", color: "#22c55e" },
  { key: "maybe", label: "Maybe", icon: "help-circle", color: "#f59e0b" },
  { key: "out", label: "Can't", icon: "close-circle", color: "#ef4444" },
];

/**
 * "You in for Monday?" — one-tap league-night RSVP for the user's team, with a
 * live count of who's confirmed. Renders nothing if the user isn't on a team.
 */
export function LeagueRsvpCard() {
  const { user } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data: d } = await supabase.rpc("rpc_my_team_rsvps");
    setData((d as Data) ?? null);
  }

  useEffect(() => {
    if (user) load();
  }, [user?.id]);

  async function setStatus(status: "in" | "maybe" | "out") {
    if (saving) return;
    haptic(status === "in" ? "success" : "tap");
    setSaving(true);
    setData((d) => (d ? { ...d, my_status: status } : d)); // optimistic
    await supabase.rpc("rpc_set_league_rsvp", { p_status: status });
    await load();
    setSaving(false);
  }

  if (!data?.has_team) return null;
  const ins = (data.members ?? []).filter((m) => m.status === "in");
  const c = data.counts ?? { in: 0, out: 0, maybe: 0, total: 0 };

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <Ionicons name="calendar" size={15} color="#06b6d4" />
        <Text style={s.title}>You in for Monday?</Text>
        <Text style={s.count}>{c.in}/{c.total} in</Text>
      </View>

      <View style={s.optionsRow}>
        {OPTIONS.map((o) => {
          const active = data.my_status === o.key;
          return (
            <Pressable
              key={o.key}
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
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderColor: "#262626", borderWidth: 1, borderRadius: 12, paddingVertical: 10, backgroundColor: "#0a0a0a",
  },
  optionText: { color: "#9a9a9a", fontSize: 13, fontWeight: "800" },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12 },
  avatarHint: { color: "#7a7a7a", fontSize: 12, fontWeight: "600", marginLeft: 6 },
});
