import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GROUP_RINGS, groupTurn, type GroupBall } from "../../lib/group-scoring";
import { Avatar } from "./avatar";
import { MotionView } from "./motion";
import { MotionSheet } from "./motion-sheet";
import { PressableScale } from "./pressable-scale";
import { haptic } from "../../lib/haptics";
import { ScoreText } from "./score-text";
import { PLAY } from "./play-ui";

type Player = { player_user_id: string; username: string; avatar_url: string | null };
export function GroupScorecard({ sessionId, players, balls, onChange, disabled = false }: {
  sessionId: string; players: Player[]; balls: GroupBall[]; onChange: (balls: GroupBall[]) => void; disabled?: boolean;
}) {
  const [accepted, setAccepted] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const lastTap = useRef(0);
  const lineup = players.map(p => p.player_user_id);
  const turn = groupTurn(lineup, balls.length);
  const player = players.find(p => p.player_user_id === turn?.playerId);
  const nextPlayer = players.find(p => p.player_user_id === turn?.nextPlayerId);
  const turnKey = `${sessionId}:${lineup.join(",")}:${turn?.round}`;
  const handoff = !!turn && players.length > 1 && accepted !== turnKey;
  const previous = balls.length > 0 ? players.find(p => p.player_user_id === balls[balls.length - 1].player_user_id) : null;
  function add(score: number) {
    if (!turn || handoff || disabled || Date.now() - lastTap.current < 250) return;
    lastTap.current = Date.now();
    haptic(score >= 50 ? "success" : "tap");
    const ball_number = balls.filter(b => b.player_user_id === turn.playerId).length + 1;
    onChange([...balls, { player_user_id: turn.playerId, ball_number, score }]);
  }
  function undo() {
    if (disabled || !balls.length) return;
    const previousTurn = groupTurn(lineup, balls.length - 1);
    setAccepted(`${sessionId}:${lineup.join(",")}:${previousTurn?.round}`);
    onChange(balls.slice(0, -1));
    haptic("light");
  }
  return <View style={s.wrap}>
    <View style={s.progress} accessibilityLabel={`${balls.length} of 9 balls recorded`}>
      {Array.from({ length: 3 }, (_, round) => <View key={round} style={s.round}>
        <Text numberOfLines={1} style={s.roundName}>{players[round % players.length]?.username}</Text>
        <View style={s.dots}>{[0, 1, 2].map(ball => <View key={ball} style={[s.dot, balls.length > round * 3 + ball && s.filled]} />)}</View>
      </View>)}
    </View>
    <View style={s.turnPanel}>{player && turn ? <MotionView transitionKey={`${turnKey}:${handoff}`} distance={6}>
      {handoff ? <View style={s.handoff}>
        <Ionicons name="phone-portrait-outline" size={30} color="#67e8f9" />
        <Text style={s.eyebrow}>{turn.ball > 1 ? "CONTINUE TURN" : balls.length ? "PASS THE PHONE" : "FIRST UP"}</Text>
        <Avatar uri={player.avatar_url} name={player.username} size={64} radius={22} />
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={s.title}>{player.username}’s turn</Text>
        <Text style={s.description}>{turn.ball > 1 ? `${turn.ball - 1} of your three balls are recorded. ${4 - turn.ball} left in this turn.` : `${previous ? `${previous.username}’s round is recorded. ` : ""}Three balls, then pass it on.`}</Text>
        <PressableScale disabled={disabled} accessibilityLabel={`Ready for ${player.username}'s turn`} style={s.ready} onPress={() => { setAccepted(turnKey); haptic("tap"); }}>
          <Text style={s.readyText}>I’m ready — {player.username}</Text><Ionicons name="arrow-forward" size={20} color="#001016" />
        </PressableScale>
      </View> : <View style={s.scorer}>
        <View style={s.playerRow}><Avatar uri={player.avatar_url} name={player.username} size={40} radius={14} /><View style={{ flex: 1 }}><Text style={s.playerName}>{player.username}</Text><Text style={s.muted}>Round {turn.round + 1} of 3 · Ball {turn.ball} of 3</Text></View></View>
        <Text style={s.prompt}>Where did it land?</Text>
        <View style={s.rings}>{GROUP_RINGS.map(score => <PressableScale key={score} disabled={disabled} accessibilityLabel={`Record ${score} points for ${player.username}`} style={[s.ring, score === 100 && s.hundo]} onPress={() => add(score)}><Text style={[s.ringText, score === 100 && { color: "#67e8f9" }]}>{score}</Text></PressableScale>)}</View>
        <Text style={s.muted}>{nextPlayer ? `Next: ${nextPlayer.username}` : "Last round — review all scores before saving."}</Text>
      </View>}
    </MotionView> : <View style={s.review}><Ionicons name="checkmark-circle-outline" size={36} color="#67e8f9" /><Text style={s.title}>All nine, nice work.</Text><Text style={s.description}>Check the scores below, then save your game.</Text></View>}</View>
    <View style={s.controlBar}>
      <View><Text style={s.muted}>Group score</Text><ScoreText value={balls.reduce((sum, b) => sum + b.score, 0)} animate style={s.total} /></View>
      <PressableScale disabled={disabled || !balls.length} style={[s.undo, !balls.length && { opacity: 0.4 }]} accessibilityLabel="Undo the last ball" onPress={undo}><Ionicons name="arrow-undo-outline" size={18} color="#cbd5e1" /><Text style={s.muted}>Undo last ball</Text></PressableScale>
    </View>
    <View style={s.summary}>
      <PressableScale accessibilityRole="button" accessibilityLabel={balls.length === 9 ? "Full scorecard shown for review" : "Show or hide the full scorecard"} disabled={balls.length === 9} accessibilityState={{ expanded: expanded || balls.length === 9 }} style={[s.playerRow, { minHeight: 44 }]} onPress={() => setExpanded(value => !value)}><View style={{ flex: 1 }}><Text style={s.summaryTitle}>{balls.length === 9 ? "Review your scorecard" : "View scorecard"}</Text><Text style={s.muted}>{balls.length}/9 balls · tap a score to correct it</Text></View>{balls.length < 9 && <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={20} color={PLAY.muted} />}</PressableScale>
      {(expanded || balls.length === 9) && players.map(p => <View key={p.player_user_id} style={s.result}>
        <View style={s.playerRow}><Text style={s.playerName}>{p.username}</Text><Text style={s.points}>{balls.filter(b => b.player_user_id === p.player_user_id).reduce((sum, b) => sum + b.score, 0)} pts</Text></View>
        <View style={s.chips}>{balls.map((ball, index) => ball.player_user_id === p.player_user_id && <PressableScale key={index} disabled={disabled} style={s.chip} accessibilityLabel={`Edit ${p.username}'s ball ${ball.ball_number}, ${ball.score} points`} onPress={() => setEditing(index)}><Text style={s.chipText}>{ball.score}</Text><Ionicons name="pencil" size={11} color="#aebfc7" /></PressableScale>)}</View>
      </View>)}
    </View>
    <MotionSheet visible={editing !== null} onClose={() => setEditing(null)} accessibilityLabel="Correct a ball score" style={{ padding: 20 }}>
      <Text style={s.summaryTitle}>Correct this ball</Text><Text style={s.description}>{players.find(p => p.player_user_id === balls[editing ?? -1]?.player_user_id)?.username} · Ball {balls[editing ?? -1]?.ball_number}</Text>
      <View style={[s.rings, { marginTop: 20 }]}>{GROUP_RINGS.map(score => <PressableScale key={score} disabled={disabled} style={s.ring} accessibilityLabel={`Change score to ${score} points`} onPress={() => { if (editing !== null) onChange(balls.map((b, index) => index === editing ? { ...b, score } : b)); setEditing(null); }}><Text style={s.ringText}>{score}</Text></PressableScale>)}</View>
    </MotionSheet>
  </View>;
}
const s = StyleSheet.create({
  turnPanel: { minHeight: 294 }, controlBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  wrap: { gap: 18 }, progress: { flexDirection: "row", gap: 10 }, round: { flex: 1, gap: 8 }, roundName: { color: "#b4c1cb", fontSize: 12, fontWeight: "700" }, dots: { flexDirection: "row", gap: 4 }, dot: { height: 5, flex: 1, backgroundColor: "#26323a", borderRadius: 3 }, filled: { backgroundColor: "#22d3ee" },
  handoff: { alignItems: "center", gap: 14, padding: 22, backgroundColor: "#0c2027", borderRadius: 22, borderWidth: 1, borderColor: "#195363" }, eyebrow: { color: "#67e8f9", letterSpacing: 2, fontSize: 12, fontWeight: "800" }, title: { color: "#fff", fontSize: 26, fontWeight: "900", textAlign: "center" }, description: { color: "#b9c7d0", fontSize: 14, lineHeight: 21, textAlign: "center" }, ready: { minHeight: 58, backgroundColor: "#22d3ee", borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, alignSelf: "stretch" }, readyText: { flex: 1, color: "#001016", fontSize: 16, fontWeight: "800" },
  scorer: { gap: 16 }, playerRow: { flexDirection: "row", alignItems: "center", gap: 12, justifyContent: "space-between" }, playerName: { color: "#fff", fontWeight: "800", fontSize: 17, flexShrink: 1 }, muted: { color: "#b4c1cb", fontSize: 13, lineHeight: 20 }, prompt: { color: "#e2e8f0", fontSize: 18, fontWeight: "700" }, rings: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, ring: { width: "31%", flexGrow: 1, minHeight: 76, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#172129", borderWidth: 1, borderColor: "#374650" }, ringText: { fontSize: 28, color: "#fff", fontWeight: "900" }, hundo: { backgroundColor: "#0c2931", borderColor: "#22d3ee" }, review: { alignItems: "center", gap: 12, padding: 20 },
  summary: { backgroundColor: "#11191e", borderRadius: 20, padding: 16, gap: 12 }, summaryTitle: { color: "#fff", fontSize: 18, fontWeight: "800" }, total: { color: "#67e8f9", fontSize: 28, fontWeight: "900" }, result: { borderTopWidth: 1, borderColor: "#293139", paddingTop: 12, gap: 8 }, points: { color: "#cbd5e1", fontSize: 14, fontWeight: "700" }, chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, chip: { minWidth: 48, minHeight: 44, borderRadius: 10, backgroundColor: "#23313a", flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 }, chipText: { color: "#e2e8f0", fontSize: 16, fontWeight: "700" }, undo: { minHeight: 48, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
});
