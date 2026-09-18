import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import { randomUUID } from "expo-crypto";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { completePractice, validPracticeGame, type PracticeGame } from "../../lib/practice";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../context/auth-context";
import { usePractice } from "../context/practice-context";
import { GroupScorecard } from "../components/group-scorecard";
import { PlayButton, PLAY, SaveStatus, playStyles as s } from "../components/play-ui";
import { ScoringAwake } from "../components/scoring-awake";
import { PressableScale } from "../components/pressable-scale";
import { MotionSheet } from "../components/motion-sheet";

export default function PracticeScreen() {
  const { user } = useAuth();
  const { state, ready, storage, save, retry } = usePractice();
  const [names, setNames] = useState(["You", ""]), [view, setView] = useState<PracticeGame | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [discard, setDiscard] = useState(false);
  const [cloud, setCloud] = useState<PracticeGame[]>([]), [savedIds, setSavedIds] = useState<string[]>([]);
  const didRestore = useRef(false), importing = useRef(false);
  const userId = user?.id;
  useEffect(() => { if (ready && !didRestore.current) { setNames(state.names); didRestore.current = true; } }, [ready, state.names]);
  useEffect(() => {
    if (!ready || storage !== "saved" || !userId || importing.current) return;
    importing.current = true;
    void AsyncStorage.getItem("@arcade:practice-claim:v1").then(async raw => {
      const game = raw ? JSON.parse(raw) : null;
      if (validPracticeGame(game) && game.completedAt !== null) {
        await save({ ...state, history: [game, ...state.history.filter(g => g.id !== game.id)].slice(0, 30) });
        setView(game);
      }
      await AsyncStorage.removeItem("@arcade:practice-claim:v1");
    }).catch(() => setError("Couldn’t restore the practice game. Your guest history is still on this device."));
  }, [ready, storage, userId, save, state]);
  useFocusEffect(useCallback(() => {
    let alive = true;
    if (!userId) { setCloud([]); setSavedIds([]); return; }
    void Promise.resolve(supabase.from("skeeball_practice_games").select("game").eq("user_id", userId).order("created_at", { ascending: false }).limit(30)).then(({ data, error: loadError }) => {
      if (!alive) return;
      if (loadError) { setError("Account history is unavailable. Games saved on this phone are still here."); return; }
      const games = (data ?? []).map(row => row.game).filter(validPracticeGame);
      setCloud(games); setSavedIds(games.map(g => g.id));
    }).catch(() => { if (alive) setError("Account history is unavailable. Games saved on this phone are still here."); });
    return () => { alive = false; };
  }, [userId]));
  async function start(nextNames = names) {
    if (busy || state.draft) return;
    const clean = nextNames.map(n => n.trim()).filter(Boolean);
    if (!clean.length || clean.length > 3) { setError("Add one to three players."); return; }
    if (new Set(clean.map(n => n.toLowerCase())).size !== clean.length) { setError("Use a different name for each player so handoffs are clear."); return; }
    setBusy(true); setError(""); setView(null);
    const game: PracticeGame = { version: 1, id: randomUUID(), startedAt: Date.now(), completedAt: null, players: clean.map(name => ({ id: randomUUID(), name })), balls: [] };
    try { await save({ ...state, draft: game, names: clean }); } catch { setError("Device storage isn’t available. Keep this game open until you finish."); }
    finally { setBusy(false); }
  }
  async function finish() {
    if (busy) return;
    setBusy(true); setError("");
    try { const next = completePractice(state, Date.now()); await save(next); setView(next.history[0]); }
    catch { setError("Couldn’t save on this phone. Tap Retry before leaving."); }
    finally { setBusy(false); }
  }
  async function saveToAccount(game: PracticeGame) {
    if (busy) return;
    if (!userId) {
      try { await AsyncStorage.setItem("@arcade:practice-claim:v1", JSON.stringify(game)); await AsyncStorage.setItem("@arcade:pending-intent:v1", "/practice"); router.push("/login"); }
      catch { setError("Couldn’t preserve this game for sign-in. Keep this screen open and retry."); }
      return;
    }
    setBusy(true); setError("");
    try {
      const result = await supabase.from("skeeball_practice_games").upsert({ id: game.id, user_id: userId, game }, { onConflict: "user_id,id", ignoreDuplicates: true });
      if (result.error) throw result.error;
      setSavedIds(ids => [...new Set([...ids, game.id])]);
      setCloud(games => [game, ...games.filter(g => g.id !== game.id)]);
    } catch { setError("Account save failed. Your game remains on this phone; try again when connected."); }
    finally { setBusy(false); }
  }
  const history = [...new Map([...cloud, ...state.history].map(game => [game.id, game])).values()].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  if (!ready) return <SafeAreaView style={s.screen}><ActivityIndicator color={PLAY.accent} /></SafeAreaView>;
  return <SafeAreaView style={s.screen} edges={["top", "bottom"]}>
    <View style={[s.row, { paddingHorizontal: 20, minHeight: 56, justifyContent: "space-between" }]}><PressableScale accessibilityLabel="Back to playing" onPress={() => router.replace("/start-game")} style={{ minHeight: 44, minWidth: 44, justifyContent: "center" }}><Ionicons name="arrow-back" size={24} color={PLAY.text} /></PressableScale><Text style={s.label}>PRACTICE · NO LEAGUE POINTS</Text></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
      {state.draft ? <>
        <SaveStatus local={storage} onRetry={() => { void retry().catch(() => {}); }} />
        <GroupScorecard sessionId={state.draft.id} players={state.draft.players.map(p => ({ player_user_id: p.id, username: p.name, avatar_url: null }))} balls={state.draft.balls} disabled={busy}
          onChange={balls => { setError(""); void save({ ...state, draft: { ...state.draft!, balls } }).catch(() => {}); }} />
        {state.draft.balls.length === 9 && <PlayButton disabled={busy} label="Save practice game" onPress={finish} />}
        <ScoringAwake active={state.draft.balls.length < 9} />
        <PlayButton secondary label="End this practice game" onPress={() => setDiscard(true)} />
      </> : view ? <>
        <Text style={s.label}>PRACTICE COMPLETE</Text><Text style={[s.title, { fontSize: 58, fontVariant: ["tabular-nums"] }]}>{view.balls.reduce((sum, ball) => sum + ball.score, 0)}</Text><Text style={s.subtitle}>Group score · nine balls</Text>
        <SaveStatus local={storage} synced={savedIds.includes(view.id)} onRetry={() => { void retry().catch(() => {}); }} />
        {view.players.map(player => <View key={player.id} style={[s.row, { justifyContent: "space-between", minHeight: 48 }]}><Text style={{ color: PLAY.text, fontSize: 18 }}>{player.name}</Text><Text style={{ color: PLAY.text, fontSize: 24, fontWeight: "800" }}>{view.balls.filter(ball => ball.player_user_id === player.id).reduce((sum, ball) => sum + ball.score, 0)}</Text></View>)}
        <PlayButton disabled={busy} label="Play again with this group" onPress={() => { setNames(view.players.map(p => p.name)); void start(view.players.map(p => p.name)); }} />
        {!savedIds.includes(view.id) && <PlayButton disabled={busy} secondary label={user ? "Save to my account" : "Sign in to keep this game online"} onPress={() => { void saveToAccount(view); }} />}
        <PlayButton secondary label="Back to practice history" onPress={() => setView(null)} />
      </> : <>
        <View style={{ gap: 8 }}><Text style={s.title}>Who’s playing?</Text><Text style={s.subtitle}>One to three players. Nine balls shared over three turns. With two players, the first player takes the last turn too.</Text></View>
        <View style={s.card}>{names.map((name, index) => <View key={index} style={s.row}><Text style={[s.label, { width: 16 }]}>{index + 1}</Text><TextInput accessibilityLabel={`Player ${index + 1} name`} placeholder={`Player ${index + 1}`} placeholderTextColor={PLAY.muted} maxLength={40} value={name} onChangeText={value => setNames(old => old.map((n, i) => i === index ? value : n))} style={[s.input, { flex: 1 }]} />{names.length > 1 && <PressableScale accessibilityLabel={`Remove player ${index + 1}`} style={{ minHeight: 48, minWidth: 44, alignItems: "center", justifyContent: "center" }} onPress={() => setNames(old => old.filter((_, i) => i !== index))}><Ionicons name="close" size={22} color={PLAY.muted} /></PressableScale>}</View>)}
          {names.length < 3 && <PlayButton secondary label="Add a player" onPress={() => setNames(old => [...old, ""])} />}
          <PlayButton disabled={busy || storage === "error"} label="Start practice game" onPress={() => { void start(); }} />
          <Text style={s.subtitle}>Saved on this device. Account saving is optional.</Text>
        </View>
        <SaveStatus local={storage} onRetry={() => { void retry().catch(() => {}); }} />
        <Text style={s.label}>RECENT PRACTICE</Text>
        {history.length === 0 ? <Text style={s.subtitle}>Your finished games will appear here.</Text> : history.map(game => <PressableScale key={game.id} accessibilityLabel={`Review practice game, ${game.balls.reduce((sum, b) => sum + b.score, 0)} points`} style={[s.card, s.row, { justifyContent: "space-between" }]} onPress={() => setView(game)}><View style={{ flex: 1 }}><Text style={{ color: PLAY.text, fontSize: 16, fontWeight: "700" }}>{game.players.map(p => p.name).join(" · ")}</Text><Text style={s.subtitle}>{new Date(game.completedAt!).toLocaleDateString()} · {savedIds.includes(game.id) ? "In your account" : "On this phone"}</Text></View><Text style={{ color: PLAY.accent, fontSize: 28, fontWeight: "900" }}>{game.balls.reduce((sum, b) => sum + b.score, 0)}</Text></PressableScale>)}
      </>}
    </ScrollView>
    <MotionSheet visible={discard} onClose={() => setDiscard(false)} accessibilityLabel="End practice game" style={{ padding: 20 }}><Text style={s.title}>End this practice?</Text><Text style={[s.subtitle, { marginVertical: 16 }]}>The unfinished scorecard will be discarded. Finished games stay in your history.</Text><PlayButton secondary label="Keep playing" onPress={() => setDiscard(false)} /><PlayButton style={{ marginTop: 12 }} label="Discard unfinished game" onPress={() => { void save({ ...state, draft: null }).then(() => setDiscard(false)).catch(() => setError("Couldn’t update device storage. Please retry.")); }} /></MotionSheet>
  </SafeAreaView>;
}
