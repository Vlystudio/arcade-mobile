import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/auth-context";
import { useActiveGame } from "../context/active-game-context";
import { usePractice } from "../context/practice-context";
import { useLocation } from "../context/location-context";
import { PlayButton, PLAY, playStyles as s } from "../components/play-ui";
import { PressableScale } from "../components/pressable-scale";
import { MotionSheet } from "../components/motion-sheet";
import { LocationPicker } from "../components/location-picker";

type Team = { id: string; name: string };
type Active = { id: string; team_id: string; lane_number: number };
export default function StartGameScreen() {
  const { user } = useAuth();
  const { draft } = useActiveGame();
  const { state: practice } = usePractice();
  const { location } = useLocation();
  const [teams, setTeams] = useState<Team[]>([]), [selected, setSelected] = useState("");
  const [current, setCurrent] = useState<Active | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [picker, setPicker] = useState(false), [venue, setVenue] = useState(false);
  const [reload, setReload] = useState(0);
  const userId = user?.id;
  useFocusEffect(useCallback(() => {
    let alive = true;
    setLoading(true); setError("");
    if (!userId) { setTeams([]); setSelected(""); setCurrent(null); setLoading(false); return; }
    async function load() {
      try {
        const [membership, recent] = await Promise.all([
          supabase.from("team_members").select("team_id, teams(id,name)").eq("user_id", userId),
          AsyncStorage.getItem(`@arcade:recent-team:v1:${userId}`).catch(() => null),
        ]);
        if (membership.error) throw membership.error;
        const list = (membership.data ?? []).flatMap(row => {
          const team = (Array.isArray(row.teams) ? row.teams[0] : row.teams) as Team | null;
          return team?.id ? [team] : [];
        });
        const active = list.length ? await supabase.from("skeeball_sessions").select("id,team_id,lane_number").in("team_id", list.map(t => t.id)).eq("status", "active").order("last_activity_at", { ascending: false }).limit(1).maybeSingle() : { data: null, error: null };
        if (active.error) throw active.error;
        if (alive) { setTeams(list); setSelected(list.find(t => t.id === active.data?.team_id)?.id ?? list.find(t => t.id === recent)?.id ?? list[0]?.id ?? ""); setCurrent(active.data); }
      } catch { if (alive) setError("Couldn’t check your team’s game. Retry, or start a practice game."); }
      finally { if (alive) setLoading(false); }
    }
    void load();
    return () => { alive = false; };
  // Changing reload intentionally reruns the focused lookup after a failed request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, reload]));
  const team = teams.find(t => t.id === selected);
  const active = current ?? (draft ? { id: draft.sessionId, team_id: draft.teamId, lane_number: draft.lane } : null);
  return <SafeAreaView style={s.screen} edges={["top", "bottom"]}>
    <ScrollView contentContainerStyle={s.content}>
      <PressableScale accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace(user ? "/games" : "/welcome")} style={{ minHeight: 44, alignSelf: "flex-start", justifyContent: "center" }}><Ionicons name="arrow-back" color={PLAY.text} size={24} /></PressableScale>
      <View style={{ gap: 8 }}><Text style={s.label}>SKEE-BALL</Text><Text style={s.title}>Let’s play.</Text><Text style={s.subtitle}>One phone. Everyone’s turn.</Text></View>
      <PressableScale onPress={() => setVenue(true)} accessibilityLabel="Change venue" style={[s.row, { minHeight: 48 }]}><Ionicons name="location-outline" size={20} color={PLAY.accent} /><Text style={[s.subtitle, { flex: 1 }]}>{location?.name ?? "Choose your venue"}</Text><Text style={{ color: PLAY.accent, fontWeight: "700" }}>Change</Text></PressableScale>
      {active && <View style={s.card}><Text style={s.label}>GAME IN PROGRESS</Text><Text style={[s.title, { fontSize: 24 }]}>Your group is on lane {active.lane_number}</Text><PlayButton label="Resume group game" onPress={() => router.push({ pathname: "/skeeball-tracker", params: { sessionId: active.id, teamId: active.team_id } })} /></View>}
      <View style={s.card}>
        <Text style={[s.title, { fontSize: 24 }]}>League game</Text><Text style={s.subtitle}>Scan your lane, confirm the lineup, and start scoring. League rules and check-in still apply.</Text>
        {loading ? <ActivityIndicator color={PLAY.accent} /> : error ? <><Text style={s.error}>{error}</Text><PlayButton secondary label="Retry team lookup" onPress={() => setReload(value => value + 1)} /></> : team ? <>
          <PressableScale style={[s.row, { minHeight: 48 }]} onPress={() => setPicker(true)} accessibilityLabel="Change league team"><Text style={{ color: PLAY.text, fontSize: 17, fontWeight: "800", flex: 1 }}>{team.name}</Text><Text style={{ color: PLAY.accent }}>Change</Text></PressableScale>
          {!active && <PlayButton label="Scan lane to start" onPress={() => { void AsyncStorage.setItem(`@arcade:recent-team:v1:${userId}`, team.id).catch(() => {}); router.push({ pathname: "/scan-lane", params: { mode: "skeeball", teamId: team.id, teamName: team.name } }); }} />}
        </> : <PlayButton secondary label={user ? "Find or join a team" : "Sign in for league play"} onPress={() => router.push(user ? "/teams" : "/login")} />}
      </View>
      <View style={s.card}><Text style={[s.title, { fontSize: 24 }]}>Just here to play?</Text><Text style={s.subtitle}>Use guest names for a casual game. No league team or account needed. Practice scores stay out of the standings.</Text><PlayButton secondary={!!active || !!team} label={practice.draft ? "Resume practice game" : "Start a practice game"} onPress={() => router.push("/practice")} /><PressableScale onPress={() => router.push("/practice")} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: PLAY.muted }}>Practice history →</Text></PressableScale></View>
      <PressableScale onPress={() => router.push("/games")} style={{ minHeight: 48, justifyContent: "center" }}><Text style={{ color: PLAY.muted }}>Already finished? Log a score from Play →</Text></PressableScale>
    </ScrollView>
    <MotionSheet visible={picker} onClose={() => setPicker(false)} accessibilityLabel="Choose your league team" style={{ padding: 20 }}><Text style={s.title}>Your teams</Text>{teams.map(t => <PlayButton key={t.id} secondary={selected !== t.id} label={t.name} style={{ marginTop: 12 }} onPress={() => { setSelected(t.id); setPicker(false); }} />)}</MotionSheet>
    <MotionSheet visible={venue} onClose={() => setVenue(false)} accessibilityLabel="Choose your venue" style={{ padding: 20 }}><LocationPicker /><PlayButton label="Done" onPress={() => setVenue(false)} /></MotionSheet>
  </SafeAreaView>;
}
