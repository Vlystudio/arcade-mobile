import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Alert } from "../../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomTabBar from "../components/bottom-tab-bar";
import { useRequireAuth } from "../hooks/use-require-auth";
import { reportError } from "../lib/report-error";
import { supabase } from "../../lib/supabase";

// --- Types ---

type TriviaGame = {
  id: string;
  title: string;
  status: "lobby" | "active" | "finished";
  current_question_id: string | null;
  current_question_index: number;
  max_participants: number;
  allow_teams: boolean;
  min_team_size: number;
  signup_token: string;
  created_at: string;
  participant_count?: number;
};

type Question = {
  id: string;
  question: string;
  question_type: "multiple_choice" | "text";
  options: { id: string; text: string }[];
  points: number;
  category: string | null;
};

type Participant = {
  id: string;
  display_name: string;
  participant_type: "individual" | "team";
  score: number;
};

type MyTeam = { id: string; name: string; member_count: number };

// --- Screen ---

export default function TriviaScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const params = useLocalSearchParams<{ token?: string }>();

  const [games, setGames] = useState<TriviaGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGame, setSelectedGame] = useState<TriviaGame | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [myParticipant, setMyParticipant] = useState<Participant | null>(null);
  const [myTeams, setMyTeams] = useState<MyTeam[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [joinModal, setJoinModal] = useState(false);
  const [joinType, setJoinType] = useState<"individual" | "team">("individual");
  const [joinTeamId, setJoinTeamId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const slideY = useSharedValue(0);
  const cardOpacity = useSharedValue(1);
  const prevQuestionId = useRef<string | null>(null);

  const questionCardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ translateY: slideY.value }],
  }));

  useEffect(() => { if (user) { loadGames(); loadMyTeams(); } }, [user]);

  useEffect(() => {
    if (params.token && games.length > 0) {
      const game = games.find(g => g.signup_token === params.token);
      if (game && game.status === "lobby") {
        setSelectedGame(game);
        setJoinModal(true);
      }
    }
  }, [params.token, games]);

  useEffect(() => {
    if (!selectedGame) return;
    const ch = supabase
      .channel(`trivia-game-${selectedGame.id}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "trivia_games",
        filter: `id=eq.${selectedGame.id}`,
      }, payload => {
        const updated = payload.new as TriviaGame;
        setSelectedGame(updated);
        if (updated.current_question_id !== prevQuestionId.current) {
          setSelectedAnswer(null);
          setTextAnswer("");
          setSubmitted(false);
          if (updated.current_question_id) {
            animateQuestionIn();
            loadQuestion(updated.current_question_id);
          }
          prevQuestionId.current = updated.current_question_id;
        }
        loadParticipants(updated.id);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selectedGame?.id]);

  async function loadGames() {
    setLoading(true);
    const { data } = await supabase
      .from("trivia_games")
      .select("*")
      .in("status", ["lobby", "active"])
      .order("created_at", { ascending: false });
    if (data) {
      const withCounts = await Promise.all(
        data.map(async (g) => {
          const { count } = await supabase
            .from("trivia_participants")
            .select("id", { count: "exact", head: true })
            .eq("game_id", g.id);
          return { ...g, participant_count: count ?? 0 };
        })
      );
      setGames(withCounts);
    }
    setLoading(false);
  }

  async function loadMyTeams() {
    if (!user) return;
    const { data } = await supabase
      .from("team_members")
      .select("team_id, teams(id, name)")
      .eq("user_id", user.id)
      .eq("status", "active");
    if (data) {
      const teams = data.map((r: any) => ({ id: r.teams.id, name: r.teams.name, member_count: 0 }));
      const withCounts = await Promise.all(
        teams.map(async (t) => {
          const { count } = await supabase
            .from("team_members")
            .select("id", { count: "exact", head: true })
            .eq("team_id", t.id)
            .eq("status", "active");
          return { ...t, member_count: count ?? 0 };
        })
      );
      setMyTeams(withCounts);
    }
  }

  async function loadQuestion(questionId: string) {
    const { data } = await supabase
      .from("trivia_questions")
      .select("id, question, question_type, options, points, category")
      .eq("id", questionId)
      .single();
    if (data) setCurrentQuestion(data as Question);
  }

  async function loadParticipants(gameId: string) {
    const { data } = await supabase
      .from("trivia_participants")
      .select("id, display_name, participant_type, score")
      .eq("game_id", gameId)
      .order("score", { ascending: false });
    if (data) setParticipants(data);
  }

  async function checkMyParticipant(gameId: string) {
    if (!user) return;
    const { data } = await supabase
      .from("trivia_participants")
      .select("id, display_name, participant_type, score")
      .eq("game_id", gameId)
      .eq("user_id", user.id)
      .maybeSingle();
    setMyParticipant(data ?? null);
  }

  async function openGame(game: TriviaGame) {
    setSelectedGame(game);
    setCurrentQuestion(null);
    setSelectedAnswer(null);
    setTextAnswer("");
    setSubmitted(false);
    prevQuestionId.current = game.current_question_id;
    await Promise.all([
      checkMyParticipant(game.id),
      loadParticipants(game.id),
      game.current_question_id ? loadQuestion(game.current_question_id) : Promise.resolve(),
    ]);
  }

  async function handleJoin() {
    if (!selectedGame || !user) return;
    if (joinType === "team" && !joinTeamId) { setJoinError("Select a team to continue."); return; }
    setJoining(true);
    setJoinError(null);
    const { data, error } = await supabase.rpc("rpc_trivia_join", {
      p_game_id: selectedGame.id,
      p_team_id: joinType === "team" ? joinTeamId : null,
    });
    setJoining(false);
    if (error || (data as any)?.error) {
      const msg = (data as any)?.error ?? error?.message ?? "Failed to join.";
      reportError("Trivia.handleJoin", msg);
      setJoinError(msg);
      return;
    }
    setJoinModal(false);
    await checkMyParticipant(selectedGame.id);
    await loadParticipants(selectedGame.id);
  }

  async function submitAnswer() {
    if (!selectedGame || !currentQuestion || !myParticipant) return;
    const answer = currentQuestion.question_type === "multiple_choice" ? selectedAnswer : textAnswer.trim();
    if (!answer) return;
    setSubmitting(true);
    const { data, error } = await supabase.rpc("rpc_trivia_submit_answer", {
      p_game_id: selectedGame.id,
      p_question_id: currentQuestion.id,
      p_answer: answer,
    });
    setSubmitting(false);
    if (error || (data as any)?.error) {
      Alert.alert("Error", (data as any)?.error ?? error?.message ?? "Failed to submit.");
      return;
    }
    setSubmitted(true);
  }

  function animateQuestionIn() {
    slideY.value = 40;
    cardOpacity.value = 0;
    slideY.value = withSpring(0, { damping: 14, stiffness: 120 });
    cardOpacity.value = withTiming(1, { duration: 280 });
  }

  if (authLoading) {
    return (
      <SafeAreaView style={s.safe}>
        <ActivityIndicator color="#06b6d4" style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (selectedGame) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <Pressable onPress={() => setSelectedGame(null)} style={s.backBtn}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>{selectedGame.title}</Text>
            <Text style={s.headerSub}>
              {selectedGame.status === "lobby"
                ? "Waiting for game to start..."
                : selectedGame.status === "active"
                  ? `Question ${selectedGame.current_question_index}`
                  : "Game finished"}
            </Text>
          </View>
          <View style={[
            s.statusBadge,
            { backgroundColor: selectedGame.status === "lobby" ? "rgba(245,158,11,0.15)" : selectedGame.status === "active" ? "rgba(34,197,94,0.15)" : "rgba(85,85,85,0.15)" },
          ]}>
            <Text style={[
              s.statusBadgeText,
              { color: selectedGame.status === "lobby" ? "#f59e0b" : selectedGame.status === "active" ? "#22c55e" : "#555" },
            ]}>
              {selectedGame.status.toUpperCase()}
            </Text>
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
          {!myParticipant && selectedGame.status === "lobby" && (
            <View style={s.joinBanner}>
              <Ionicons name="hand-right-outline" size={22} color="#06b6d4" />
              <View style={{ flex: 1 }}>
                <Text style={s.joinBannerTitle}>You are not signed up yet</Text>
                <Text style={s.joinBannerSub}>Join before the host starts the game.</Text>
              </View>
              <Pressable style={s.joinBannerBtn} onPress={() => { setJoinError(null); setJoinModal(true); }}>
                <Text style={s.joinBannerBtnText}>Join</Text>
              </Pressable>
            </View>
          )}

          {myParticipant && (
            <View style={s.myBadge}>
              <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
              <Text style={s.myBadgeText}>
                {"You're in as "}
                <Text style={{ color: "#fff", fontWeight: "800" }}>{myParticipant.display_name}</Text>
              </Text>
            </View>
          )}

          {selectedGame.status === "active" && currentQuestion && (
            <Animated.View style={[s.questionCard, questionCardStyle]}>
              <View style={s.questionHeader}>
                {currentQuestion.category && (
                  <View style={s.categoryTag}>
                    <Text style={s.categoryTagText}>{currentQuestion.category}</Text>
                  </View>
                )}
                <Text style={s.questionPoints}>{currentQuestion.points} pts</Text>
              </View>
              <Text style={s.questionText}>{currentQuestion.question}</Text>

              {submitted ? (
                <View style={s.submittedBanner}>
                  <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
                  <Text style={s.submittedText}>Answer submitted! Wait for the next question.</Text>
                </View>
              ) : !myParticipant ? (
                <View style={s.notJoinedNote}>
                  <Text style={s.notJoinedNoteText}>Sign up for the next game to participate.</Text>
                </View>
              ) : currentQuestion.question_type === "multiple_choice" ? (
                <View style={s.optionsGrid}>
                  {currentQuestion.options.map((opt) => (
                    <Pressable
                      key={opt.id}
                      style={[s.optionBtn, selectedAnswer === opt.id && s.optionBtnSelected]}
                      onPress={() => setSelectedAnswer(opt.id)}
                    >
                      <View style={[s.optionLetter, selectedAnswer === opt.id && s.optionLetterSelected]}>
                        <Text style={[s.optionLetterText, selectedAnswer === opt.id && { color: "#000" }]}>
                          {opt.id.toUpperCase()}
                        </Text>
                      </View>
                      <Text style={[s.optionText, selectedAnswer === opt.id && s.optionTextSelected]}>
                        {opt.text}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    style={[s.submitBtn, !selectedAnswer && s.submitBtnDisabled]}
                    onPress={submitAnswer}
                    disabled={!selectedAnswer || submitting}
                  >
                    {submitting
                      ? <ActivityIndicator color="#000" size="small" />
                      : <Text style={s.submitBtnText}>Submit Answer</Text>
                    }
                  </Pressable>
                </View>
              ) : (
                <View style={s.textAnswerWrap}>
                  <TextInput
                    style={s.textAnswerInput}
                    placeholder="Type your answer..."
                    placeholderTextColor="#444"
                    value={textAnswer}
                    onChangeText={setTextAnswer}
                    multiline
                  />
                  <Pressable
                    style={[s.submitBtn, !textAnswer.trim() && s.submitBtnDisabled]}
                    onPress={submitAnswer}
                    disabled={!textAnswer.trim() || submitting}
                  >
                    {submitting
                      ? <ActivityIndicator color="#000" size="small" />
                      : <Text style={s.submitBtnText}>Submit Answer</Text>
                    }
                  </Pressable>
                </View>
              )}
            </Animated.View>
          )}

          {selectedGame.status === "lobby" && (
            <View style={s.lobbyWaiting}>
              <ActivityIndicator color="#06b6d4" />
              <Text style={s.lobbyWaitingText}>Waiting for host to start the game...</Text>
            </View>
          )}

          {selectedGame.status === "finished" && (
            <View style={s.finishedBanner}>
              <Text style={s.finishedTitle}>Game Over!</Text>
              <Text style={s.finishedSub}>Final Scores</Text>
            </View>
          )}

          {participants.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>
                {selectedGame.status === "finished" ? "Final Standings" : "Scoreboard"}
              </Text>
              {participants.map((p, i) => (
                <View key={p.id} style={[s.participantRow, p.id === myParticipant?.id && s.participantRowMe]}>
                  <Text style={[
                    s.participantRank,
                    i === 0 && { color: "#f59e0b" },
                    i === 1 && { color: "#9ca3af" },
                    i === 2 && { color: "#b45309" },
                  ]}>
                    {i === 0 ? "1st" : i === 1 ? "2nd" : i === 2 ? "3rd" : `#${i + 1}`}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.participantName}>{p.display_name}</Text>
                    <Text style={s.participantType}>{p.participant_type === "team" ? "Team" : "Individual"}</Text>
                  </View>
                  <Text style={s.participantScore}>{p.score} pts</Text>
                </View>
              ))}
            </View>
          )}

          {participants.length === 0 && selectedGame.status === "lobby" && (
            <View style={s.emptyParticipants}>
              <Text style={s.emptyParticipantsText}>No participants yet. Be the first to join!</Text>
            </View>
          )}
        </ScrollView>

        <Modal visible={joinModal} transparent animationType="slide" onRequestClose={() => setJoinModal(false)}>
          <Pressable style={jm.backdrop} onPress={() => setJoinModal(false)} />
          <View style={jm.sheet}>
            <View style={jm.handle} />
            <Text style={jm.title}>Join Game</Text>
            <Text style={jm.sub}>{selectedGame.title} - Choose how you want to compete.</Text>

            {joinError && (
              <View style={jm.errorBanner}>
                <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
                <Text style={jm.errorText}>{joinError}</Text>
              </View>
            )}

            <View style={jm.typeRow}>
              <Pressable
                style={[jm.typeBtn, joinType === "individual" && jm.typeBtnActive]}
                onPress={() => setJoinType("individual")}
              >
                <Ionicons name="person-outline" size={20} color={joinType === "individual" ? "#06b6d4" : "#555"} />
                <Text style={[jm.typeBtnText, joinType === "individual" && jm.typeBtnTextActive]}>Individual</Text>
              </Pressable>
              {selectedGame.allow_teams && (
                <Pressable
                  style={[jm.typeBtn, joinType === "team" && jm.typeBtnActive]}
                  onPress={() => setJoinType("team")}
                >
                  <Ionicons name="people-outline" size={20} color={joinType === "team" ? "#06b6d4" : "#555"} />
                  <Text style={[jm.typeBtnText, joinType === "team" && jm.typeBtnTextActive]}>Team</Text>
                </Pressable>
              )}
            </View>

            {joinType === "team" && (
              <View style={jm.teamList}>
                <Text style={jm.teamListLabel}>
                  Select your team (min {selectedGame.min_team_size} members required):
                </Text>
                {myTeams.length === 0 && (
                  <Text style={jm.noTeamsText}>
                    You are not on any team. Join a team first or sign up individually.
                  </Text>
                )}
                {myTeams.map((t) => (
                  <Pressable
                    key={t.id}
                    style={[
                      jm.teamRow,
                      joinTeamId === t.id && jm.teamRowSelected,
                      t.member_count < selectedGame.min_team_size && jm.teamRowDisabled,
                    ]}
                    onPress={() => { if (t.member_count >= selectedGame.min_team_size) setJoinTeamId(t.id); }}
                  >
                    <Ionicons name="people" size={16} color={joinTeamId === t.id ? "#06b6d4" : "#444"} />
                    <Text style={[jm.teamName, joinTeamId === t.id && { color: "#06b6d4" }]}>{t.name}</Text>
                    <Text style={[jm.teamCount, t.member_count < selectedGame.min_team_size && { color: "#ef4444" }]}>
                      {t.member_count} member{t.member_count !== 1 ? "s" : ""}
                      {t.member_count < selectedGame.min_team_size ? ` (need ${selectedGame.min_team_size})` : ""}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            <Pressable style={[jm.joinBtn, joining && { opacity: 0.6 }]} onPress={handleJoin} disabled={joining}>
              {joining
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={jm.joinBtnText}>Confirm Join</Text>
              }
            </Pressable>
            <Pressable style={jm.cancelBtn} onPress={() => setJoinModal(false)}>
              <Text style={jm.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </Modal>

        <BottomTabBar />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Text style={s.pageTitle}>Trivia</Text>
        <Pressable onPress={loadGames} style={s.refreshBtn}>
          <Ionicons name="refresh" size={20} color="#555" />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color="#06b6d4" style={{ marginTop: 60 }} />
      ) : games.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="help-circle-outline" size={52} color="#222" />
          <Text style={s.emptyTitle}>No Active Games</Text>
          <Text style={s.emptySub}>A host will start a trivia game soon. Check back!</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
          {games.map((game) => (
            <Pressable key={game.id} style={s.gameCard} onPress={() => openGame(game)}>
              <View style={s.gameCardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={s.gameCardTitle}>{game.title}</Text>
                  <Text style={s.gameCardMeta}>
                    {game.participant_count ?? 0}/{game.max_participants} players
                    {game.allow_teams ? ` - Teams allowed (min ${game.min_team_size})` : " - Individual only"}
                  </Text>
                </View>
                <View style={[
                  s.gameStatusBadge,
                  { backgroundColor: game.status === "lobby" ? "rgba(245,158,11,0.15)" : "rgba(34,197,94,0.15)" },
                ]}>
                  <View style={[s.gameStatusDot, { backgroundColor: game.status === "lobby" ? "#f59e0b" : "#22c55e" }]} />
                  <Text style={[s.gameStatusText, { color: game.status === "lobby" ? "#f59e0b" : "#22c55e" }]}>
                    {game.status === "lobby" ? "Open" : "Live"}
                  </Text>
                </View>
              </View>
              <View style={s.gameCardFooter}>
                <Ionicons name="arrow-forward-circle-outline" size={16} color="#06b6d4" />
                <Text style={s.gameCardJoin}>
                  {game.status === "lobby" ? "Tap to sign up" : "Tap to play"}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <BottomTabBar />
    </SafeAreaView>
  );
}

// --- Styles ---

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 14, gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#1a1a1a",
  },
  pageTitle: { flex: 1, color: "#fff", fontSize: 24, fontWeight: "900" },
  refreshBtn: { padding: 6 },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#111", alignItems: "center", justifyContent: "center",
  },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },
  headerSub: { color: "#8a8a8a", fontSize: 12, marginTop: 1 },
  statusBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  gameCard: { backgroundColor: "#111", borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#1e1e1e" },
  gameCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
  gameCardTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },
  gameCardMeta: { color: "#8a8a8a", fontSize: 12, marginTop: 3 },
  gameStatusBadge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  gameStatusDot: { width: 6, height: 6, borderRadius: 3 },
  gameStatusText: { fontSize: 11, fontWeight: "800" },
  gameCardFooter: { flexDirection: "row", alignItems: "center", gap: 5 },
  gameCardJoin: { color: "#06b6d4", fontSize: 13, fontWeight: "700" },
  joinBanner: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(6,182,212,0.07)", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "rgba(6,182,212,0.2)", marginBottom: 16 },
  joinBannerTitle: { color: "#06b6d4", fontSize: 14, fontWeight: "800" },
  joinBannerSub: { color: "#8a8a8a", fontSize: 12, marginTop: 1 },
  joinBannerBtn: { backgroundColor: "#06b6d4", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  joinBannerBtnText: { color: "#000", fontWeight: "900", fontSize: 13 },
  myBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(34,197,94,0.08)", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16, borderWidth: 1, borderColor: "rgba(34,197,94,0.2)", alignSelf: "flex-start" },
  myBadgeText: { color: "#22c55e", fontSize: 12, fontWeight: "700" },
  questionCard: { backgroundColor: "#111", borderRadius: 20, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: "#1e1e1e" },
  questionHeader: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 8 },
  categoryTag: { backgroundColor: "rgba(168,85,247,0.12)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: "rgba(168,85,247,0.2)" },
  categoryTagText: { color: "#a855f7", fontSize: 11, fontWeight: "800" },
  questionPoints: { marginLeft: "auto" as any, color: "#f59e0b", fontSize: 12, fontWeight: "900" },
  questionText: { color: "#fff", fontSize: 18, fontWeight: "800", lineHeight: 26, marginBottom: 20 },
  optionsGrid: { gap: 10 },
  optionBtn: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#0d0d0d", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#1e1e1e" },
  optionBtnSelected: { backgroundColor: "rgba(6,182,212,0.1)", borderColor: "rgba(6,182,212,0.5)" },
  optionLetter: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center" },
  optionLetterSelected: { backgroundColor: "#06b6d4" },
  optionLetterText: { color: "#8a8a8a", fontSize: 13, fontWeight: "900" },
  optionText: { color: "#888", fontSize: 14, fontWeight: "600", flex: 1 },
  optionTextSelected: { color: "#06b6d4" },
  textAnswerWrap: { gap: 12 },
  textAnswerInput: { backgroundColor: "#0d0d0d", borderRadius: 14, padding: 14, color: "#fff", fontSize: 15, borderWidth: 1, borderColor: "#1e1e1e", minHeight: 80, textAlignVertical: "top" },
  submitBtn: { backgroundColor: "#06b6d4", borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },
  submittedBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(34,197,94,0.08)", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "rgba(34,197,94,0.2)" },
  submittedText: { color: "#22c55e", fontSize: 13, fontWeight: "700", flex: 1 },
  notJoinedNote: { backgroundColor: "#0d0d0d", borderRadius: 12, padding: 12 },
  notJoinedNoteText: { color: "#777", fontSize: 13, textAlign: "center" },
  lobbyWaiting: { alignItems: "center", paddingVertical: 32, gap: 10 },
  lobbyWaitingText: { color: "#8a8a8a", fontSize: 14 },
  finishedBanner: { alignItems: "center", paddingVertical: 24, marginBottom: 8 },
  finishedTitle: { color: "#f59e0b", fontSize: 26, fontWeight: "900" },
  finishedSub: { color: "#8a8a8a", fontSize: 14, marginTop: 4 },
  section: { marginTop: 8 },
  sectionTitle: { color: "#8a8a8a", fontSize: 12, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 },
  participantRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  participantRowMe: { backgroundColor: "rgba(6,182,212,0.04)", borderRadius: 12, paddingHorizontal: 8 },
  participantRank: { color: "#8a8a8a", fontSize: 14, fontWeight: "900", width: 36, textAlign: "center" },
  participantName: { color: "#fff", fontSize: 14, fontWeight: "800" },
  participantType: { color: "#777", fontSize: 11, marginTop: 1 },
  participantScore: { color: "#06b6d4", fontSize: 16, fontWeight: "900" },
  emptyParticipants: { paddingVertical: 20, alignItems: "center" },
  emptyParticipantsText: { color: "#777", fontSize: 13 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 12 },
  emptyTitle: { color: "#fff", fontSize: 20, fontWeight: "900" },
  emptySub: { color: "#8a8a8a", fontSize: 14, textAlign: "center", lineHeight: 20 },
});

const jm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40, borderTopWidth: 1, borderColor: "#1e1e1e" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#333", alignSelf: "center", marginBottom: 16 },
  title: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  sub: { color: "#8a8a8a", fontSize: 13, marginBottom: 16 },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 10, padding: 10, marginBottom: 14, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },
  errorText: { color: "#ef4444", fontSize: 12, flex: 1 },
  typeRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  typeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14, borderWidth: 1, borderColor: "#1e1e1e", backgroundColor: "#0d0d0d" },
  typeBtnActive: { borderColor: "rgba(6,182,212,0.5)", backgroundColor: "rgba(6,182,212,0.08)" },
  typeBtnText: { color: "#8a8a8a", fontWeight: "800", fontSize: 14 },
  typeBtnTextActive: { color: "#06b6d4" },
  teamList: { marginBottom: 16 },
  teamListLabel: { color: "#8a8a8a", fontSize: 12, fontWeight: "700", marginBottom: 8 },
  noTeamsText: { color: "#777", fontSize: 13, textAlign: "center", paddingVertical: 12 },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#0d0d0d", borderRadius: 12, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: "#1e1e1e" },
  teamRowSelected: { borderColor: "rgba(6,182,212,0.5)", backgroundColor: "rgba(6,182,212,0.06)" },
  teamRowDisabled: { opacity: 0.4 },
  teamName: { flex: 1, color: "#888", fontSize: 14, fontWeight: "700" },
  teamCount: { color: "#8a8a8a", fontSize: 12 },
  joinBtn: { backgroundColor: "#06b6d4", borderRadius: 16, paddingVertical: 16, alignItems: "center", marginBottom: 10 },
  joinBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
  cancelBtn: { alignItems: "center", paddingVertical: 12 },
  cancelBtnText: { color: "#8a8a8a", fontWeight: "700", fontSize: 14 },
});
