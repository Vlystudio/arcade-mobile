import { Image } from "expo-image";
import { pickFromCamera, pickFromLibrary } from "../../lib/pick-image";
import { compressImage, MAX_UPLOAD_BYTES } from "../../lib/compress-image";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { validateScoreValue } from "../../lib/validation";

const SKEE_RINGS = [10, 20, 30, 40, 50, 100];
const BALLS_PER_GAME = 9;

const RING_COLORS: Record<number, string> = {
  10:  "#555",
  20:  "#555",
  30:  "#3b82f6",
  40:  "#8b5cf6",
  50:  "#22c55e",
  100: "#06b6d4",
};

export default function SubmitScoreScreen() {
  const { lane_id, lane_number, game_id, game_name, game_type, check_in_id, venue_id } =
    useLocalSearchParams<{ lane_id: string; lane_number: string; game_id: string; game_name: string; game_type: string; check_in_id: string; venue_id: string }>();

  const isSkeeball = game_type === "skeeball";

  const [balls, setBalls] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [arcadeScore, setArcadeScore] = useState("");
  const [proofUri, setProofUri] = useState<string | null>(null);

  useEffect(() => {
    if (!submitted) return;
    const t = setTimeout(() => router.replace("/games"), 1400);
    return () => clearTimeout(t);
  }, [submitted]);

  const total = balls.reduce((sum, b) => sum + b, 0);
  const gameComplete = isSkeeball ? balls.length === BALLS_PER_GAME : true;
  const canSubmit = (isSkeeball ? gameComplete : arcadeScore.length > 0) && proofUri !== null;

  function addBall(pts: number) {
    if (balls.length >= BALLS_PER_GAME) return;
    setBalls((prev) => [...prev, pts]);
  }

  async function pickProofFromCamera() {
    const asset = await pickFromCamera({ allowsEditing: false, quality: 0.85 });
    if (asset) setProofUri(asset.uri);
  }

  async function pickProofFromLibrary() {
    const asset = await pickFromLibrary({ allowsEditing: false, quality: 0.85 });
    if (asset) setProofUri(asset.uri);
  }

  // Uploads photo to the private score-proofs bucket and returns the storage path.
  // The caller then attaches the path via rpc_attach_score_proof; no public URL is stored.
  async function uploadProofPhoto(userId: string, scoreId: string): Promise<{ path: string } | null> {
    if (!proofUri) return null;
    try {
      const compressed = await compressImage(proofUri);
      const response = await fetch(compressed);
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_UPLOAD_BYTES) {
        Alert.alert("Photo too large", "Please choose a photo under 5 MB.");
        return null;
      }
      const path = `${userId}/${scoreId}.jpg`;
      const { error } = await supabase.storage
        .from("score-proofs")
        .upload(path, arrayBuffer, { upsert: true, contentType: "image/jpeg" });
      if (error) throw error;
      return { path };
    } catch {
      return null;
    }
  }

  async function handleSubmit() {
    setSubmitError(null);
    const scoreCheck = validateScoreValue(isSkeeball ? total : arcadeScore);
    if (!scoreCheck.ok) {
      setSubmitError(scoreCheck.error);
      return;
    }
    const finalScore = scoreCheck.value;
    if (!proofUri) {
      setSubmitError("Please add a photo proof of your score.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        setSubmitError("You must be logged in to submit a score.");
        setSubmitting(false);
        return;
      }

      const { data: rpcResult, error: rpcError } = await supabase.rpc("rpc_submit_score", {
        p_game_id:     game_id     || null,
        p_lane_id:     lane_id     || null,
        p_check_in_id: check_in_id || null,
        p_venue_id:    venue_id    || null,
        p_score:       finalScore,
        p_frame_data:  isSkeeball ? balls.map((pts, i) => ({ ball: i + 1, pts })) : null,
      });

      const rpcData = rpcResult as { ok?: boolean; score_id?: string; error?: string; message?: string } | null;
      if (rpcError || rpcData?.error) {
        setSubmitError(rpcData?.message ?? rpcError?.message ?? "Score submission failed.");
        setSubmitting(false);
        return;
      }

      const scoreId = rpcData?.score_id;
      if (!scoreId) {
        setSubmitError("Score submission failed — no score ID returned.");
        setSubmitting(false);
        return;
      }

      const uploaded = await uploadProofPhoto(user.id, scoreId);
      if (uploaded) {
        const { error: proofErr } = await supabase.rpc("rpc_attach_score_proof", {
          p_score_id:     scoreId,
          p_storage_path: uploaded.path,
        });
        if (proofErr) {
          // Path attachment failed — remove the orphaned file from storage
          await supabase.storage.from("score-proofs").remove([uploaded.path]);
        }
      }
    } catch (e: any) {
      setSubmitError(e?.message ?? "Unexpected error — please try again.");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        <View style={styles.successOverlay}>
          <View style={styles.successIconWrap}>
            <Ionicons name="checkmark-circle" size={72} color="#22c55e" />
          </View>
          <Text style={styles.successTitle}>Score Submitted!</Text>
          <Text style={styles.successSub}>Pending admin review — heading to games…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header card */}
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.gameName}>{game_name ?? "Game"}</Text>
              <Text style={styles.laneLabel}>
                {isSkeeball ? `Lane ${lane_number ?? "?"}` : "Arcade / Pinball"}
              </Text>
            </View>
            {isSkeeball && (
              <View style={styles.ballsLeft}>
                <Text style={styles.ballsLeftNum}>{BALLS_PER_GAME - balls.length}</Text>
                <Text style={styles.ballsLeftLabel}>balls left</Text>
              </View>
            )}
            <View style={styles.pendingBadge}>
              <Ionicons name="time-outline" size={12} color="#f59e0b" />
              <Text style={styles.pendingBadgeText}>Needs review</Text>
            </View>
          </View>
          {isSkeeball && (
            <View style={styles.progressDots}>
              {Array.from({ length: BALLS_PER_GAME }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    i < balls.length && styles.dotDone,
                    i === balls.length && styles.dotNext,
                  ]}
                />
              ))}
            </View>
          )}
        </View>

        {isSkeeball ? (
          <>
            {/* Score display */}
            <View style={styles.scoreDisplay}>
              <Text style={styles.scoreNum}>{total}</Text>
              <Text style={styles.scorePts}>pts</Text>
            </View>

            {balls.length < BALLS_PER_GAME ? (
              <>
                <Text style={styles.ringHint}>Ball {balls.length + 1} — pick ring</Text>
                <View style={styles.ringGrid}>
                  {SKEE_RINGS.map((pts) => (
                    <Pressable
                      key={pts}
                      style={({ pressed }) => [
                        styles.ringBtn,
                        pts === 100 && styles.ringBtnCenter,
                        pressed && styles.ringBtnPressed,
                        { borderColor: RING_COLORS[pts] + "55" },
                      ]}
                      onPress={() => addBall(pts)}
                    >
                      <Text style={[styles.ringBtnText, { color: RING_COLORS[pts] }, pts === 100 && styles.ringBtnTextLarge]}>
                        {pts}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : (
              <View style={styles.completeRow}>
                <Ionicons name="checkmark-circle" size={22} color="#22c55e" />
                <Text style={styles.gameCompleteLabel}>Game complete!</Text>
              </View>
            )}

            {balls.length > 0 && (
              <View style={styles.historySection}>
                <View style={styles.historyChips}>
                  {balls.map((pts, i) => (
                    <View
                      key={i}
                      style={[
                        styles.chip,
                        { borderColor: RING_COLORS[pts] + "44", backgroundColor: RING_COLORS[pts] + "18" },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: RING_COLORS[pts] }]}>{pts}</Text>
                    </View>
                  ))}
                </View>
                {balls.length < BALLS_PER_GAME && (
                  <Pressable style={styles.undoBtn} onPress={() => setBalls((prev) => prev.slice(0, -1))}>
                    <Ionicons name="arrow-undo-outline" size={14} color="#555" />
                    <Text style={styles.undoText}>Undo last ball</Text>
                  </Pressable>
                )}
              </View>
            )}

            {gameComplete && (
              <View style={styles.submitSection}>
                <View style={styles.finalRow}>
                  <Text style={styles.finalLabel}>Final Score</Text>
                  <Text style={styles.finalScore}>{total.toLocaleString()}</Text>
                </View>

                {/* Photo proof — required for skee-ball */}
                <View style={styles.proofSection}>
                  <View style={styles.proofHeader}>
                    <Ionicons name="camera" size={16} color="#06b6d4" />
                    <Text style={styles.proofTitle}>Photo Proof</Text>
                    <View style={styles.requiredBadge}>
                      <Text style={styles.requiredText}>Required</Text>
                    </View>
                  </View>
                  <Text style={styles.proofSub}>Take a photo of the score screen on the machine</Text>
                  {proofUri ? (
                    <View style={styles.proofPicker}>
                      <Image source={{ uri: proofUri }} style={styles.proofThumb} contentFit="cover" />
                      <View style={styles.proofOverlay}>
                        <View style={styles.proofCheckCircle}>
                          <Ionicons name="checkmark" size={18} color="#000" />
                        </View>
                      </View>
                      <View style={styles.proofChangeRow}>
                        <Pressable style={styles.proofChangeChip} onPress={pickProofFromCamera}>
                          <Ionicons name="camera-outline" size={13} color="#fff" />
                          <Text style={styles.proofChangeText}>Retake</Text>
                        </Pressable>
                        <Pressable style={styles.proofChangeChip} onPress={pickProofFromLibrary}>
                          <Ionicons name="images-outline" size={13} color="#fff" />
                          <Text style={styles.proofChangeText}>Library</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.proofPickerEmpty}>
                      <View style={styles.proofEmpty}>
                        <View style={styles.proofIconCircle}>
                          <Ionicons name="camera-outline" size={28} color="#06b6d4" />
                        </View>
                        <Text style={styles.proofEmptyText}>Add photo proof</Text>
                        <Text style={styles.proofEmptyHint}>Score screen on the machine</Text>
                      </View>
                      <View style={styles.proofBtnRow}>
                        <Pressable style={styles.proofCameraBtn} onPress={pickProofFromCamera}>
                          <Ionicons name="camera" size={18} color="#000" />
                          <Text style={styles.proofCameraBtnText}>Take Photo</Text>
                        </Pressable>
                        <Pressable style={styles.proofLibraryBtn} onPress={pickProofFromLibrary}>
                          <Ionicons name="images-outline" size={18} color="#fff" />
                          <Text style={styles.proofLibraryBtnText}>From Library</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                </View>

                <RequirementsChecklist isSkeeball={true} gameComplete={gameComplete} proofUri={proofUri} arcadeScore={arcadeScore} />
                {submitError && (
                  <View style={styles.submitErrorBox}>
                    <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
                    <Text style={styles.submitErrorText}>{submitError}</Text>
                  </View>
                )}
                <SubmitButton
                  label={submitting ? "Submitting…" : "Submit for Review"}
                  onPress={handleSubmit}
                  disabled={!canSubmit || submitting}
                  loading={submitting}
                  icon={canSubmit && !submitting ? "arrow-up-circle" : undefined}
                />
                <Text style={styles.reviewNote}>
                  An admin will verify your photo before it appears on the leaderboard.
                </Text>
                <Pressable style={styles.restartBtn} onPress={() => { setBalls([]); setProofUri(null); }}>
                  <Text style={styles.restartText}>Restart Game</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : (
          /* ── Arcade / Pinball ── */
          <View style={styles.arcadeSection}>
            <Text style={styles.arcadeHint}>Enter your final score</Text>
            <TextInput
              style={styles.arcadeInput}
              placeholder="0"
              placeholderTextColor="#2a2a2a"
              keyboardType="number-pad"
              value={arcadeScore}
              onChangeText={setArcadeScore}
              autoFocus
            />
            {arcadeScore.length > 0 && (
              <Text style={styles.arcadePreview}>
                {parseInt(arcadeScore, 10).toLocaleString()} pts
              </Text>
            )}

            {/* Photo proof */}
            <View style={styles.proofSection}>
              <View style={styles.proofHeader}>
                <Ionicons name="camera" size={16} color="#06b6d4" />
                <Text style={styles.proofTitle}>Photo Proof</Text>
                <View style={styles.requiredBadge}>
                  <Text style={styles.requiredText}>Required</Text>
                </View>
              </View>
              <Text style={styles.proofSub}>Upload a photo of your score screen</Text>

              {proofUri ? (
                <View style={styles.proofPicker}>
                  <Image source={{ uri: proofUri }} style={styles.proofThumb} contentFit="cover" />
                  <View style={styles.proofOverlay}>
                    <View style={styles.proofCheckCircle}>
                      <Ionicons name="checkmark" size={18} color="#000" />
                    </View>
                  </View>
                  <View style={styles.proofChangeRow}>
                    <Pressable style={styles.proofChangeChip} onPress={pickProofFromCamera}>
                      <Ionicons name="camera-outline" size={13} color="#fff" />
                      <Text style={styles.proofChangeText}>Retake</Text>
                    </Pressable>
                    <Pressable style={styles.proofChangeChip} onPress={pickProofFromLibrary}>
                      <Ionicons name="images-outline" size={13} color="#fff" />
                      <Text style={styles.proofChangeText}>Library</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.proofPickerEmpty}>
                  <View style={styles.proofEmpty}>
                    <View style={styles.proofIconCircle}>
                      <Ionicons name="camera-outline" size={28} color="#06b6d4" />
                    </View>
                    <Text style={styles.proofEmptyText}>Add photo proof</Text>
                    <Text style={styles.proofEmptyHint}>Score screen, machine display, etc.</Text>
                  </View>
                  <View style={styles.proofBtnRow}>
                    <Pressable style={styles.proofCameraBtn} onPress={pickProofFromCamera}>
                      <Ionicons name="camera" size={18} color="#000" />
                      <Text style={styles.proofCameraBtnText}>Take Photo</Text>
                    </Pressable>
                    <Pressable style={styles.proofLibraryBtn} onPress={pickProofFromLibrary}>
                      <Ionicons name="images-outline" size={18} color="#fff" />
                      <Text style={styles.proofLibraryBtnText}>From Library</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>

            <RequirementsChecklist isSkeeball={false} gameComplete={true} proofUri={proofUri} arcadeScore={arcadeScore} />
            {submitError && (
              <View style={styles.submitErrorBox}>
                <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
                <Text style={styles.submitErrorText}>{submitError}</Text>
              </View>
            )}
            <SubmitButton
              label={submitting ? "Submitting…" : "Submit for Review"}
              onPress={handleSubmit}
              disabled={!canSubmit || submitting}
              loading={submitting}
              icon={canSubmit && !submitting ? "arrow-up-circle" : undefined}
            />
            <Text style={styles.reviewNote}>
              An admin will verify your score before it appears on the leaderboard.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RequirementsChecklist({ isSkeeball, gameComplete, proofUri, arcadeScore }: {
  isSkeeball: boolean; gameComplete: boolean; proofUri: string | null; arcadeScore: string;
}) {
  const items = [
    ...(isSkeeball
      ? [{ done: gameComplete,          label: "All 9 balls entered" }]
      : [{ done: arcadeScore.length > 0, label: "Score entered" }]),
    { done: proofUri !== null, label: "Photo proof added" },
  ];
  const allDone = items.every((i) => i.done);
  if (allDone) return null;
  return (
    <View style={styles.reqList}>
      {items.map((item) => (
        <View key={item.label} style={styles.reqItem}>
          <Ionicons
            name={item.done ? "checkmark-circle" : "ellipse-outline"}
            size={15}
            color={item.done ? "#22c55e" : "#444"}
          />
          <Text style={[styles.reqText, item.done && styles.reqTextDone]}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function SubmitButton({ label, onPress, disabled, loading, icon }: {
  label: string; onPress: () => void; disabled: boolean; loading?: boolean; icon?: string;
}) {
  return (
    <Pressable
      style={[styles.submitBtn, disabled && styles.submitBtnDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      {loading && <ActivityIndicator size="small" color="#000" style={{ marginRight: 4 }} />}
      <Text style={[styles.submitBtnText, disabled && styles.submitBtnTextOff]}>{label}</Text>
      {icon && <Ionicons name={icon as any} size={20} color="#000" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#080808" },
  content: { padding: 20, paddingBottom: 48 },

  headerCard: {
    backgroundColor: "#111", borderRadius: 22, padding: 20,
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 24,
  },
  headerTop: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "flex-start", marginBottom: 14,
  },
  gameName: { color: "#fff", fontSize: 22, fontWeight: "900", marginBottom: 4 },
  laneLabel: { color: "#555", fontSize: 13 },
  ballsLeft: { alignItems: "center" },
  ballsLeftNum: { color: "#06b6d4", fontSize: 28, fontWeight: "900" },
  ballsLeftLabel: { color: "#555", fontSize: 11 },
  pendingBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.3)",
  },
  pendingBadgeText: { color: "#f59e0b", fontSize: 11, fontWeight: "700" },
  progressDots: { flexDirection: "row", gap: 7 },
  dot: { flex: 1, height: 5, borderRadius: 3, backgroundColor: "#1e1e1e" },
  dotDone: { backgroundColor: "#22c55e" },
  dotNext: { backgroundColor: "#06b6d4" },

  scoreDisplay: {
    flexDirection: "row", alignItems: "flex-end",
    justifyContent: "center", gap: 8, marginBottom: 8,
  },
  scoreNum: { color: "#fff", fontSize: 88, fontWeight: "900", lineHeight: 96 },
  scorePts: { color: "#333", fontSize: 22, fontWeight: "700", paddingBottom: 18 },

  ringHint: {
    color: "#444", fontSize: 12, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1.2,
    textAlign: "center", marginBottom: 18,
  },
  completeRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 24 },
  gameCompleteLabel: { color: "#22c55e", fontSize: 18, fontWeight: "800" },
  ringGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "center", marginBottom: 24 },
  ringBtn: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: "#111", alignItems: "center", justifyContent: "center",
    borderWidth: 1.5,
  },
  ringBtnCenter: { width: 104, height: 104, borderRadius: 52, backgroundColor: "rgba(6,182,212,0.08)" },
  ringBtnPressed: { opacity: 0.55, transform: [{ scale: 0.92 }] },
  ringBtnText: { fontSize: 24, fontWeight: "900" },
  ringBtnTextLarge: { fontSize: 30 },

  historySection: { marginBottom: 16 },
  historyChips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 10 },
  chip: { borderRadius: 9, paddingHorizontal: 11, paddingVertical: 7, borderWidth: 1 },
  chipText: { fontWeight: "800", fontSize: 14 },
  undoBtn: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 5, paddingVertical: 8,
  },
  undoText: { color: "#555", fontSize: 13, fontWeight: "600" },

  submitSection: { marginTop: 8 },
  finalRow: {
    backgroundColor: "#111", borderRadius: 18, padding: 18,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 14,
  },
  finalLabel: { color: "#555", fontSize: 14, fontWeight: "700" },
  finalScore: { color: "#22c55e", fontSize: 36, fontWeight: "900" },

  submitBtn: {
    backgroundColor: "#06b6d4", borderRadius: 18, paddingVertical: 18,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, marginBottom: 10,
  },
  submitBtnDisabled: { backgroundColor: "#141414" },
  submitBtnText: { color: "#000", fontWeight: "900", fontSize: 17 },
  submitBtnTextOff: { color: "#333" },

  restartBtn: {
    backgroundColor: "transparent", borderRadius: 14, paddingVertical: 14,
    alignItems: "center", borderWidth: 1, borderColor: "#1e1e1e",
  },
  restartText: { color: "#444", fontWeight: "700" },

  arcadeSection: { marginTop: 4 },
  arcadeHint: { color: "#aaa", fontSize: 13, fontWeight: "700", textAlign: "center", marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 },
  arcadeInput: {
    backgroundColor: "#111", color: "#fff", padding: 24, borderRadius: 20,
    fontSize: 40, fontWeight: "900", textAlign: "center",
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 10,
  },
  arcadePreview: { color: "#06b6d4", fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 28 },

  proofSection: {
    backgroundColor: "#0f0f0f", borderRadius: 22, padding: 18,
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 20,
  },
  proofHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  proofTitle: { color: "#fff", fontSize: 15, fontWeight: "800", flex: 1 },
  requiredBadge: {
    backgroundColor: "rgba(239,68,68,0.12)", borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.3)",
  },
  requiredText: { color: "#ef4444", fontSize: 10, fontWeight: "800" },
  proofSub: { color: "#444", fontSize: 12, marginBottom: 16 },

  proofPicker: {
    height: 180, borderRadius: 16, overflow: "hidden",
    borderWidth: 1.5, borderColor: "#22c55e44",
  },
  proofPickerEmpty: {
    borderRadius: 16, borderWidth: 2,
    borderColor: "#1e1e1e", borderStyle: "dashed",
    paddingVertical: 24, alignItems: "center", gap: 16,
  },
  proofThumb: { width: "100%", height: "100%" },
  proofOverlay: { position: "absolute", top: 10, right: 10 },
  proofCheckCircle: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "#22c55e", alignItems: "center", justifyContent: "center",
  },
  proofChangeRow: {
    position: "absolute", bottom: 10, right: 10,
    flexDirection: "row", gap: 6,
  },
  proofChangeChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(0,0,0,0.72)", borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: "#333",
  },
  proofChangeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  proofBtnRow: { flexDirection: "row", gap: 10 },
  proofCameraBtn: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "#06b6d4", borderRadius: 13,
    paddingHorizontal: 18, paddingVertical: 12,
  },
  proofCameraBtnText: { color: "#000", fontWeight: "900", fontSize: 14 },
  proofLibraryBtn: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "#1a1a1a", borderRadius: 13,
    paddingHorizontal: 18, paddingVertical: 12,
    borderWidth: 1, borderColor: "#2a2a2a",
  },
  proofLibraryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  proofEmpty: { alignItems: "center", gap: 10 },
  proofIconCircle: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: "rgba(6,182,212,0.1)", borderWidth: 1,
    borderColor: "rgba(6,182,212,0.3)", alignItems: "center", justifyContent: "center",
  },
  proofEmptyText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  proofEmptyHint: { color: "#444", fontSize: 12 },

  reviewNote: { color: "#444", fontSize: 12, textAlign: "center", marginTop: 6, lineHeight: 18 },
  submitErrorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 12,
    padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.25)",
  },
  submitErrorText: { color: "#ef4444", fontSize: 13, flex: 1 },

  reqList: { gap: 6, marginBottom: 14, paddingHorizontal: 4 },
  reqItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  reqText: { color: "#444", fontSize: 13 },
  reqTextDone: { color: "#22c55e" },

  successOverlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  successIconWrap: {
    width: 104, height: 104, borderRadius: 52,
    backgroundColor: "rgba(34,197,94,0.1)", borderWidth: 1,
    borderColor: "rgba(34,197,94,0.25)", alignItems: "center",
    justifyContent: "center", marginBottom: 24,
  },
  successTitle: { color: "#fff", fontSize: 26, fontWeight: "900", marginBottom: 10 },
  successSub: { color: "#555", fontSize: 14, textAlign: "center", lineHeight: 20 },
});
