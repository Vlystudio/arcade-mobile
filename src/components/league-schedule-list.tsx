import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { scheduleMinutes, venueDate } from "../../lib/experience";
import { PLAY, PlayButton, playStyles as s } from "./play-ui";

type Slot = { team_id: string; week_of: string; slot_time: string; week_label: string | null; teams: { name: string } | { name: string }[] | null };
export function LeagueScheduleList({ teamId, compact = false }: { teamId?: string | null; compact?: boolean }) {
  const [slots, setSlots] = useState<Slot[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    let alive = true;
    if (compact && !teamId) { setLoading(false); setSlots([]); return; }
    setLoading(true); setError(false);
    let query = supabase.from("team_schedule").select("team_id,week_of,slot_time,week_label,teams(name)").gte("week_of", venueDate()).order("week_of").limit(100);
    if (teamId) query = query.eq("team_id", teamId);
    void Promise.resolve(query).then(({ data, error }) => {
      if (!alive) return;
      setError(!!error); setLoading(false);
      const sorted = ((data ?? []) as Slot[]).sort((a, b) => a.week_of.localeCompare(b.week_of) || scheduleMinutes(a.slot_time) - scheduleMinutes(b.slot_time));
      setSlots(compact ? sorted.slice(0, 1) : sorted);
    }).catch(() => { if (alive) { setError(true); setLoading(false); } });
    return () => { alive = false; };
  // Retry intentionally reloads this focused schedule without changing its filters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, compact, retry]));
  return <View style={{ gap: 12 }}>
    <Text style={s.label}>{compact ? "YOUR NEXT MATCH" : "UPCOMING LEAGUE NIGHTS"}</Text>
    {loading ? <ActivityIndicator color={PLAY.accent} /> : error ? <><Text style={s.subtitle}>Schedule unavailable.</Text><PlayButton secondary label="Retry schedule" onPress={() => setRetry(n => n + 1)} /></> : slots.length ? slots.map((slot, i) => <View key={`${slot.team_id}:${slot.week_of}:${i}`} style={compact ? { gap: 6 } : [s.card, { gap: 6 }]}>
      <Text style={{ color: PLAY.text, fontSize: compact ? 22 : 18, fontWeight: "800" }}>{new Date(`${slot.week_of}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {slot.slot_time}</Text>
      <Text style={s.subtitle}>{Array.isArray(slot.teams) ? slot.teams[0]?.name : slot.teams?.name}{slot.week_label ? ` · ${slot.week_label}` : ""}</Text>
    </View>) : <Text style={s.subtitle}>{compact && !teamId ? "Join a team to see your next match here." : "No upcoming time has been posted yet."}</Text>}
    {!compact && <PlayButton secondary label="Open full season schedule" onPress={() => router.push("/skeeball-schedule")} />}
  </View>;
}
