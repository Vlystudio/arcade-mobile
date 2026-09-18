import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { scheduleMinutes, venueDate } from "../../lib/experience";
import { useAuth } from "../context/auth-context";
import { useLocation } from "../context/location-context";
import { useActiveGame } from "../context/active-game-context";
import { PressableScale } from "./pressable-scale";
import { LeagueRsvpCard } from "./league-rsvp-card";
import { LocationPicker } from "./location-picker";
import { MotionSheet } from "./motion-sheet";
import { IntentStarter } from "./intent-starter";
import { PLAY } from "./play-ui";

type NextGame = { team_id: string; slot_time: string; week_of: string; week_label: string | null };
export function TonightCard() {
  const { user } = useAuth();
  const userId = user?.id;
  const { location } = useLocation();
  const { draft } = useActiveGame();
  const [next, setNext] = useState<NextGame | null>(null);
  const [remoteGame, setRemoteGame] = useState<{ id: string; team_id: string; lane_number: number } | null>(null);
  const [hasTeam, setHasTeam] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [recap, setRecap] = useState(false);
  const [venueOpen, setVenueOpen] = useState(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    if (!userId) return;
    async function load() {
      setFailed(false);
      try {
        const [members, night] = await Promise.all([
          supabase.from("team_members").select("team_id").eq("user_id", userId),
          supabase.rpc("rpc_my_skeeball_night"),
        ]);
        if (members.error) throw members.error;
        const ids = (members.data ?? []).map(m => m.team_id);
        const [schedule, current] = ids.length ? await Promise.all([
          supabase.from("team_schedule").select("team_id, slot_time, week_of, week_label").in("team_id", ids).gte("week_of", venueDate()).order("week_of").limit(100),
          supabase.from("skeeball_sessions").select("id, team_id, lane_number").in("team_id", ids).eq("status", "active").order("last_activity_at", { ascending: false }).limit(1).maybeSingle(),
        ]) : [{ data: [], error: null }, { data: null, error: null }];
        if (schedule.error) throw schedule.error;
        const upcoming = (schedule.data ?? []).sort((a, b) => a.week_of.localeCompare(b.week_of) || scheduleMinutes(a.slot_time) - scheduleMinutes(b.slot_time))[0] ?? null;
        if (active) { setNext(upcoming); setRemoteGame(current.data); setHasTeam(ids.length > 0); setRecap(!!night.data?.has_data); }
      } catch { if (active) setFailed(true); }
      finally { if (active) setLoaded(true); }
    }
    void load();
    return () => { active = false; };
  }, [userId]));
  const tonight = next?.week_of === venueDate();
  const game = draft ? { id: draft.sessionId, team_id: draft.teamId, lane_number: draft.lane } : remoteGame;
  const date = next ? new Date(`${next.week_of}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  return <View style={s.wrap}>
    <IntentStarter />
    <View style={s.hero}>
      <View style={s.row}><Text style={s.eyebrow}>YOUR NIGHT</Text><PressableScale accessibilityLabel="Change venue" style={s.venue} onPress={() => setVenueOpen(true)}><Ionicons name="location-outline" size={16} color={PLAY.accent} /><Text style={s.venueText}>{location?.shortName ?? "Choose venue"}</Text><Ionicons name="chevron-down" size={14} color={PLAY.muted} /></PressableScale></View>
      <Text style={s.title}>{game ? "Pick up your game." : tonight ? "It’s league night." : "Ready to roll?"}</Text>
      <Text style={s.description}>{draft ? `Lane ${draft.lane} · ${Object.values(draft.playerBalls).reduce((n, b) => n + b.length, 0)} of 9 balls entered` : game ? `Lane ${game.lane_number} · Your team is checked in` : !loaded ? "Checking your next game…" : failed ? "Schedule unavailable. You can still browse games and your team." : next ? `${date} · ${next.slot_time}${next.week_label ? ` · ${next.week_label}` : ""}` : hasTeam ? "No upcoming time posted for your team yet." : "Find a game, bring your team, or order something good."}</Text>
      <PressableScale style={s.primary} onPress={() => game ? router.push({ pathname: "/skeeball-tracker", params: { teamId: game.team_id, teamName: draft?.teamName, sessionId: game.id } }) : router.push("/start-game")}>
        <Text style={s.primaryText}>{game ? "Resume game" : "Start playing"}</Text><Ionicons name="arrow-forward" size={19} color="#001016" />
      </PressableScale>
      {draft && <Text style={s.note}>Your lane stays checked in. Inactive games may expire after 10 minutes.</Text>}
      {next && <PressableScale accessibilityLabel="View your next league game" onPress={() => router.push("/skeeball-schedule")} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: PLAY.accent, fontSize: 14 }}>Your next league game · {date} at {next.slot_time} →</Text></PressableScale>}
    </View>
    <LeagueRsvpCard weekOf={next?.week_of} teamId={next?.team_id} />
    <View style={s.links}>
      <PressableScale style={s.link} onPress={() => router.push("/food")}><Ionicons name="restaurant-outline" size={21} color="#67e8f9" /><Text style={s.linkText}>Order food</Text></PressableScale>
      <PressableScale style={s.link} onPress={() => router.push(recap ? "/skeeball-recap" : "/teams")}><Ionicons name={recap ? "stats-chart-outline" : "people-outline"} size={21} color="#67e8f9" /><Text style={s.linkText}>{recap ? "Your last night" : "Find your team"}</Text></PressableScale>
    </View>
    <Text style={s.feedTitle}>Around the arcade</Text>
    <MotionSheet visible={venueOpen} onClose={() => setVenueOpen(false)} accessibilityLabel="Choose your venue" style={{ padding: 20 }}>
      <Text style={s.feedTitle}>Choose your venue</Text><LocationPicker /><PressableScale style={s.primary} onPress={() => setVenueOpen(false)}><Text style={s.primaryText}>Done</Text></PressableScale>
    </MotionSheet>
  </View>;
}
const s = StyleSheet.create({ wrap: { padding: 16 }, hero: { backgroundColor: "#10262e", borderColor: "#164651", borderWidth: 0, borderRadius: 22, padding: 20, gap: 14, marginBottom: 12 }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, eyebrow: { color: "#67e8f9", letterSpacing: 1.6, fontSize: 12, fontWeight: "800" }, title: { color: "#fff", fontSize: 28, fontWeight: "900", letterSpacing: -0.6 }, description: { color: "#c4d3da", fontSize: 15, lineHeight: 22 }, primary: { backgroundColor: "#22d3ee", padding: 14, minHeight: 48, borderRadius: 13, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }, primaryText: { color: "#001016", fontWeight: "800", fontSize: 15 }, note: { color: "#aebfc7", fontSize: 12, lineHeight: 18 }, venue: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, maxWidth: "65%" }, venueText: { color: "#e0f2fe", flexShrink: 1, fontSize: 14 }, links: { flexDirection: "row", gap: 10 }, link: { flex: 1, backgroundColor: "#14181b", padding: 16, borderRadius: 14, gap: 8, minHeight: 80 }, linkText: { color: "#e5e7eb", fontSize: 14, fontWeight: "700" }, feedTitle: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 22 } });
