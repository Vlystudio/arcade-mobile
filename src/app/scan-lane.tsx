import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import SkeeballTrackerScreen from "./skeeball-tracker";

type CheckInResult = {
  check_in_id: string;
  lane_id: string;
  lane_number: number;
  game_id: string;
  game_name: string;
  game_type: string;
  venue_id: string;
};

type MyTeam = {
  id: string;
  name: string;
};

type ActiveSkeeballSession = {
  sessionId: string;
  laneNumber: number;
  teamId: string;
  teamName: string;
};

export default function ScanLaneScreen() {
  const { mode, teamId, teamName, lane_token, token: routeToken } = useLocalSearchParams<{
    mode?: string;
    teamId?: string;
    teamName?: string;
    lane_token?: string;
    token?: string;
  }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showScanHelp, setShowScanHelp] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [pendingTokenWithoutTeam, setPendingTokenWithoutTeam] = useState<string | null>(null);
  const [myTeams, setMyTeams] = useState<MyTeam[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedTeamName, setSelectedTeamName] = useState<string | null>(null);
  const [handledRouteToken, setHandledRouteToken] = useState(false);
  const [checkInResult, setCheckInResult] = useState<CheckInResult | null>(null);
  const [cameraZoom, setCameraZoom] = useState(0);
  const [openingScoring, setOpeningScoring] = useState(false);
  const [scoringHref, setScoringHref] = useState<string | null>(null);
  const [activeSkeeballSession, setActiveSkeeballSession] = useState<ActiveSkeeballSession | null>(null);

  const routeLaneToken = useMemo(() => {
    const raw = lane_token ?? routeToken;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [lane_token, routeToken]);
  const activeTeamId = selectedTeamId ?? teamId;
  const activeTeamName = selectedTeamName ?? teamName;
  const isSkeeballMode = mode === "skeeball" || !!activeTeamId || !!routeLaneToken;

  const extractToken = (data: string) => {
    try {
      const url = new URL(data);
      const t = url.searchParams.get("lane_token") ?? url.searchParams.get("token");
      if (t) return t;
    } catch { /* not a URL */ }
    return data.trim();
  };

  const loadMyTeams = async () => {
    setTeamsLoading(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        Alert.alert("Not logged in", "Please log in before checking in.");
        return;
      }

      const { data, error } = await supabase
        .from("team_members")
        .select("team_id, teams(id, name)")
        .eq("user_id", user.id);

      if (error) throw error;

      const teams = (data ?? [])
        .map((row: any) => {
          const team = Array.isArray(row.teams) ? row.teams[0] : row.teams;
          return team?.id ? { id: team.id, name: team.name ?? "Team" } : null;
        })
        .filter(Boolean) as MyTeam[];

      setMyTeams(teams);
    } catch {
      Alert.alert("Teams unavailable", "Could not load your teams. Open the scanner from your team page or try again.");
    } finally {
      setTeamsLoading(false);
    }
  };

  const handleCheckIn = async (qrData: string) => {
    if (loading) return;
    setLoading(true);
    try {
      const token = extractToken(qrData);

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        Alert.alert("Not logged in", "Please log in before checking in.");
        setScanned(false);
        return;
      }

      if (isSkeeballMode) {
        await startSkeeballCheckIn(token);
        return;
      }

      const { data, error } = await supabase.rpc("rpc_check_in", { p_token: token });

      if (error) {
        Alert.alert("Check-in failed", error.message);
        setScanned(false);
        return;
      }

      const result = data as {
        error?: string; message?: string;
        check_in_id?: string; lane_id?: string; lane_number?: number;
        game_id?: string; game_name?: string; game_type?: string; venue_id?: string;
      };

      if (result.error) {
        Alert.alert("Can't check in", result.message ?? "Something went wrong.");
        setScanned(false);
        return;
      }

      openSubmitScore({
        check_in_id: result.check_in_id ?? "",
        lane_id:     result.lane_id     ?? "",
        lane_number: result.lane_number ?? 0,
        game_id:     result.game_id     ?? "",
        game_name:   result.game_name   ?? "Game",
        game_type:   result.game_type   ?? "arcade",
        venue_id:    result.venue_id    ?? "",
      });
    } catch (err) {
      Alert.alert("Check-in failed", err instanceof Error ? err.message : "Something went wrong.");
      setScanned(false);
    } finally {
      setLoading(false);
    }
  };

  const handleBarcodeScanned = (scan: { data?: string; rawValue?: string; nativeEvent?: { data?: string; rawValue?: string } }) => {
    if (scanned) return;
    const data = scan.data ?? scan.rawValue ?? scan.nativeEvent?.data ?? scan.nativeEvent?.rawValue;
    if (!data) {
      setCameraError("The camera saw a code but could not read its contents. Try moving closer or use the link fallback below.");
      return;
    }
    setScanned(true);
    handleCheckIn(data);
  };

  const handleScanAgain = () => {
    setCheckInResult(null);
    setPendingTokenWithoutTeam(null);
    setManualToken("");
    setOpeningScoring(false);
    setScoringHref(null);
    setActiveSkeeballSession(null);
    setScanned(false);
  };

  const openSubmitScore = (result: CheckInResult) => {
    router.replace({
      pathname: "/submit-score",
      params: {
        lane_id: result.lane_id,
        lane_number: String(result.lane_number),
        game_id: result.game_id,
        game_name: result.game_name,
        game_type: result.game_type,
        check_in_id: result.check_in_id,
        venue_id: result.venue_id,
      },
    });
  };

  const startSkeeballCheckIn = async (token: string, teamOverride?: MyTeam) => {
    const checkInTeamId = teamOverride?.id ?? activeTeamId;
    const checkInTeamName = teamOverride?.name ?? activeTeamName;
    if (!checkInTeamId) {
      setPendingTokenWithoutTeam(token);
      await loadMyTeams();
      setScanned(false);
      return;
    }

    setOpeningScoring(true);
    setPendingTokenWithoutTeam(null);
    if (teamOverride) {
      setSelectedTeamId(teamOverride.id);
      setSelectedTeamName(checkInTeamName ?? teamOverride.name);
    }
    try {
      const { data, error } = await supabase.rpc("rpc_skeeball_start_qr_session", {
        p_token: token,
        p_team_id: checkInTeamId,
      });
      if (error) throw error;

      const result = data as {
        ok?: boolean;
        error?: string;
        message?: string;
        session_id?: string;
        lane_number?: number;
        team_id?: string;
        team_name?: string;
      };

      if (!result?.ok) {
        Alert.alert("Can't check in", result?.message ?? "This lane is not available.");
        setOpeningScoring(false);
        setScanned(false);
        return;
      }

      if (!result.session_id) {
        Alert.alert("Check-in failed", "The lane session was created, but no session ID was returned. Please scan again.");
        setOpeningScoring(false);
        setScanned(false);
        return;
      }

      openSkeeballSession({
        sessionId: result.session_id,
        laneNumber: result.lane_number ?? 0,
        teamId: result.team_id ?? checkInTeamId,
        teamName: result.team_name ?? checkInTeamName ?? "Team",
      });
    } catch (err) {
      Alert.alert("Check-in failed", err instanceof Error ? err.message : "Something went wrong.");
      setOpeningScoring(false);
      setScanned(false);
    }
  };

  const openSkeeballSession = ({
    sessionId,
    laneNumber,
    teamId,
    teamName,
  }: {
    sessionId: string;
    laneNumber: number;
    teamId: string;
    teamName: string;
  }) => {
    const params = new URLSearchParams({
      teamId,
      teamName,
      sessionId,
      laneNumber: String(laneNumber),
      fromQr: "1",
    });
    const href = `/skeeball-tracker?${params.toString()}`;
    setScoringHref(href);
    setOpeningScoring(true);
    setPendingTokenWithoutTeam(null);
    setScanned(true);
    setActiveSkeeballSession({ sessionId, laneNumber, teamId, teamName });

    const webGlobal = globalThis as typeof globalThis & {
      history?: { replaceState: (data: unknown, unused: string, url?: string | URL | null) => void };
    };
    if (webGlobal.history?.replaceState) {
      webGlobal.history.replaceState(null, "", href);
    }
  };

  const setZoomPreset = (value: number) => {
    setCameraZoom(Math.max(0, Math.min(1, value)));
  };

  // ── Check-in success screen ───────────────────────────────────────────────

  const handleManualSubmit = () => {
    const value = manualToken.trim();
    if (!value) return;
    setScanned(true);
    handleCheckIn(value);
  };

  const handleTeamForPendingToken = async (team: MyTeam) => {
    if (!pendingTokenWithoutTeam) return;
    setSelectedTeamId(team.id);
    setSelectedTeamName(team.name);
    setScanned(true);
    await startSkeeballCheckIn(pendingTokenWithoutTeam, team);
  };

  useEffect(() => {
    if (!routeLaneToken || handledRouteToken) return;
    setHandledRouteToken(true);
    setManualToken(routeLaneToken);
    setScanned(true);
    handleCheckIn(routeLaneToken);
  }, [handledRouteToken, routeLaneToken]);

  useEffect(() => {
    if (!permission?.granted || scanned || checkInResult) return;
    const timeout = setTimeout(() => setShowScanHelp(true), 8000);
    return () => clearTimeout(timeout);
  }, [permission?.granted, scanned, checkInResult]);

  if (activeSkeeballSession) {
    return (
      <SkeeballTrackerScreen
        initialTeamId={activeSkeeballSession.teamId}
        initialTeamName={activeSkeeballSession.teamName}
        initialSessionId={activeSkeeballSession.sessionId}
        initialFromQr
        onBack={handleScanAgain}
      />
    );
  }

  if (checkInResult) {
    return (
      <SafeAreaView style={styles.successRoot} edges={["top", "bottom"]}>
        <View style={styles.successCard}>
          <View style={styles.successIconWrap}>
            <Ionicons name="checkmark-circle" size={56} color="#22c55e" />
          </View>
          <Text style={styles.successCheckedIn}>Checked in!</Text>
          <Text style={styles.successLane}>Lane {checkInResult.lane_number}</Text>
          <Text style={styles.successGame}>{checkInResult.game_name}</Text>
        </View>

        <View style={styles.successActions}>
          <Pressable
            style={styles.submitScoreBtn}
            onPress={() => openSubmitScore(checkInResult)}
          >
            <Ionicons name="trophy" size={20} color="#000" />
            <Text style={styles.submitScoreBtnText}>Submit Score</Text>
          </Pressable>

          <Pressable style={styles.notNowBtn} onPress={handleScanAgain}>
            <Text style={styles.notNowText}>Not now</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Permission gates ──────────────────────────────────────────────────────

  if (!permission && !routeLaneToken) {
    return (
      <SafeAreaView style={styles.centerPage}>
        <ActivityIndicator color="#06b6d4" />
      </SafeAreaView>
    );
  }

  if (!permission?.granted && !routeLaneToken) {
    return (
      <SafeAreaView style={styles.centerPage}>
        <View style={styles.permCard}>
          <View style={styles.permIcon}>
            <Ionicons name="camera-outline" size={32} color="#06b6d4" />
          </View>
          <Text style={styles.permTitle}>Camera Access Needed</Text>
          <Text style={styles.permSub}>Camera access is required to scan lane QR codes.</Text>
          <Pressable style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>Allow Camera</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Scanner ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <View style={styles.cameraSection}>
        {permission?.granted ? (
          <CameraView
            style={styles.camera}
            facing="back"
            zoom={cameraZoom}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
            onCameraReady={() => {
              setCameraReady(true);
              setCameraError(null);
            }}
            onMountError={(event) => {
              setCameraError(event.message || "The camera could not start.");
            }}
          />
        ) : (
          <View style={styles.cameraFallback}>
            <Ionicons name="qr-code-outline" size={48} color="#06b6d4" />
            <Text style={styles.cameraFallbackTitle}>QR link opened</Text>
            <Text style={styles.cameraFallbackText}>Choose your team below to continue checking in.</Text>
          </View>
        )}
        {permission?.granted && <View style={styles.overlay}>
          <View style={styles.overlayTop} />
          <View style={styles.overlayMiddle}>
            <View style={styles.overlaySide} />
            <View style={styles.scanFrame}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
            <View style={styles.overlaySide} />
          </View>
          <View style={styles.overlayBottom} />
        </View>}
        {permission?.granted && (
          <View style={styles.zoomControls}>
            {[0, 0.25, 0.5].map((zoom) => {
              const selected = Math.abs(cameraZoom - zoom) < 0.01;
              return (
                <Pressable
                  key={zoom}
                  style={[styles.zoomBtn, selected && styles.zoomBtnSelected]}
                  onPress={() => setZoomPreset(zoom)}
                >
                  <Text style={[styles.zoomBtnText, selected && styles.zoomBtnTextSelected]}>
                    {zoom === 0 ? "1x" : zoom === 0.25 ? "2x" : "3x"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>{isSkeeballMode ? "Scan Skee-Ball Lane" : "Scan Lane QR Code"}</Text>
        <Text style={styles.panelSub}>
          {isSkeeballMode
            ? `Point at your lane QR code${activeTeamName ? ` for ${activeTeamName}` : ""}`
            : "Point at the QR code posted on your lane"}
        </Text>

        {(loading || openingScoring) && (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#06b6d4" size="small" />
            <Text style={styles.statusText}>{openingScoring ? "Opening scoring..." : "Checking in..."}</Text>
          </View>
        )}

        {openingScoring && scoringHref && (
          <Pressable
            style={styles.manualOpenBtn}
            onPress={() => {
              const webGlobal = globalThis as typeof globalThis & {
                location?: { assign: (url: string) => void };
              };
              if (webGlobal.location?.assign) {
                webGlobal.location.assign(scoringHref);
              } else {
                router.replace(scoringHref as any);
              }
            }}
          >
            <Ionicons name="open-outline" size={16} color="#000" />
            <Text style={styles.manualOpenBtnText}>Open Scoring</Text>
          </Pressable>
        )}

        {!routeLaneToken && !loading && !openingScoring && !cameraReady && !cameraError && (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#06b6d4" size="small" />
            <Text style={styles.statusText}>Starting camera...</Text>
          </View>
        )}

        {cameraError && (
          <View style={styles.inlineNotice}>
            <Ionicons name="alert-circle-outline" size={16} color="#f59e0b" />
            <Text style={styles.inlineNoticeText}>{cameraError}</Text>
          </View>
        )}

        {showScanHelp && !scanned && !loading && !openingScoring && (
          <View style={styles.inlineNotice}>
            <Ionicons name="bulb-outline" size={16} color="#06b6d4" />
            <Text style={styles.inlineNoticeText}>If the web scanner does not react, open the QR with your phone camera or paste the QR link below.</Text>
          </View>
        )}

        {scanned && !loading && !openingScoring && (
          <Pressable style={styles.rescanBtn} onPress={handleScanAgain}>
            <Ionicons name="refresh-outline" size={16} color="#fff" />
            <Text style={styles.rescanText}>Scan Again</Text>
          </Pressable>
        )}

        {__DEV__ && (
          <View style={styles.testSection}>
            <Text style={styles.testLabel}>Dev: Test Lanes</Text>
            <View style={styles.testGrid}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <Pressable
                  key={n}
                  style={styles.testBtn}
                  onPress={() => { setScanned(true); handleCheckIn(`lane-${n}-demo-token`); }}
                >
                  <Text style={styles.testBtnText}>Lane {n}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View style={styles.manualBox}>
          <Text style={styles.manualLabel}>QR Link Fallback</Text>
          <TextInput
            style={styles.manualInput}
            placeholder="Paste QR link or lane token"
            placeholderTextColor="#444"
            autoCapitalize="none"
            autoCorrect={false}
            value={manualToken}
            onChangeText={setManualToken}
            onSubmitEditing={handleManualSubmit}
          />
          <Pressable
            style={[styles.manualBtn, (!manualToken.trim() || loading) && styles.manualBtnOff]}
            onPress={handleManualSubmit}
            disabled={!manualToken.trim() || loading}
          >
            <Ionicons name="log-in-outline" size={16} color="#000" />
            <Text style={styles.manualBtnText}>Use QR Link</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={!!pendingTokenWithoutTeam} transparent animationType="fade" onRequestClose={handleScanAgain}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmIconWrap}>
              <Ionicons name="people-outline" size={30} color="#06b6d4" />
            </View>
            <Text style={styles.confirmEyebrow}>Choose team</Text>
            <Text style={styles.confirmTitle}>Pick the team checking in</Text>
            <Text style={styles.confirmSub}>
              QR links identify the lane. Your team tells the league who owns it for this game.
            </Text>
            {teamsLoading ? (
              <ActivityIndicator color="#06b6d4" style={{ marginVertical: 12 }} />
            ) : (
              <ScrollView style={styles.teamPickerList}>
                {myTeams.map((team) => (
                  <Pressable key={team.id} style={styles.teamPickerRow} onPress={() => handleTeamForPendingToken(team)}>
                    <Text style={styles.teamPickerName}>{team.name}</Text>
                    <Ionicons name="chevron-forward" size={18} color="#555" />
                  </Pressable>
                ))}
                {myTeams.length === 0 && (
                  <Text style={styles.noTeamsText}>You are not on a team yet. Join or create a team before lane check-in.</Text>
                )}
              </ScrollView>
            )}
            <Pressable style={styles.fullCancelBtn} onPress={handleScanAgain}>
              <Text style={styles.confirmCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const CORNER_SIZE = 20;
const CORNER_WIDTH = 3;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  centerPage: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 24 },

  cameraSection: { flex: 1, position: "relative" },
  camera: { flex: 1 },
  cameraFallback: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, backgroundColor: "#050505" },
  cameraFallbackTitle: { color: "#fff", fontSize: 22, fontWeight: "900", marginTop: 14, marginBottom: 6, textAlign: "center" },
  cameraFallbackText: { color: "#777", fontSize: 14, lineHeight: 20, textAlign: "center" },
  overlay: { ...StyleSheet.absoluteFill, flexDirection: "column" },
  overlayTop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  overlayMiddle: { height: 240, flexDirection: "row" },
  overlaySide: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  overlayBottom: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  scanFrame: { width: 240, height: 240, position: "relative" },
  corner: { position: "absolute", width: CORNER_SIZE, height: CORNER_SIZE },
  cornerTL: { top: 0, left: 0, borderTopWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH, borderColor: "#06b6d4", borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderColor: "#06b6d4", borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH, borderColor: "#06b6d4", borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderColor: "#06b6d4", borderBottomRightRadius: 4 },
  zoomControls: {
    position: "absolute",
    bottom: 18,
    alignSelf: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.62)",
    borderRadius: 18,
    padding: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  zoomBtn: {
    minWidth: 42,
    height: 34,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomBtnSelected: { backgroundColor: "#06b6d4" },
  zoomBtnText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  zoomBtnTextSelected: { color: "#000" },

  panel: { backgroundColor: "#000", padding: 24, paddingBottom: 12 },
  panelTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  panelSub: { color: "#555", fontSize: 14, marginBottom: 16 },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  statusText: { color: "#888", fontSize: 14 },
  manualOpenBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#06b6d4",
    borderRadius: 12,
    paddingVertical: 13,
    marginBottom: 12,
  },
  manualOpenBtnText: { color: "#000", fontWeight: "900", fontSize: 14 },
  inlineNotice: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#101010", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#222", marginBottom: 12 },
  inlineNoticeText: { color: "#aaa", fontSize: 13, lineHeight: 18, flex: 1 },

  rescanBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#111", borderRadius: 12,
    paddingVertical: 12, marginBottom: 12,
    borderWidth: 1, borderColor: "#222",
  },
  rescanText: { color: "#fff", fontWeight: "700" },

  testSection: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a", paddingTop: 16 },
  testLabel: { color: "#444", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 },
  testGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  testBtn: {
    backgroundColor: "#111", borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  testBtnText: { color: "#888", fontWeight: "700", fontSize: 13 },
  manualBox: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a", paddingTop: 14, marginTop: 4 },
  manualLabel: { color: "#444", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  manualInput: { backgroundColor: "#0d0d0d", borderWidth: 1, borderColor: "#222", borderRadius: 12, color: "#fff", fontSize: 14, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 10 },
  manualBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#06b6d4", borderRadius: 12, paddingVertical: 13 },
  manualBtnOff: { opacity: 0.45 },
  manualBtnText: { color: "#000", fontWeight: "900", fontSize: 14 },

  permCard: { backgroundColor: "#111", borderRadius: 24, padding: 28, alignItems: "center", borderWidth: 1, borderColor: "#1e1e1e", width: "100%" },
  permIcon: { width: 64, height: 64, borderRadius: 18, backgroundColor: "rgba(6,182,212,0.1)", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  permTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 8, textAlign: "center" },
  permSub: { color: "#555", fontSize: 14, textAlign: "center", marginBottom: 24, lineHeight: 20 },
  permBtn: { backgroundColor: "#06b6d4", borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14 },
  permBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },

  // Success screen
  successRoot: { flex: 1, backgroundColor: "#000", justifyContent: "center", padding: 28 },
  successCard: {
    backgroundColor: "#111", borderRadius: 28, padding: 32,
    alignItems: "center", borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 24,
  },
  successIconWrap: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: "rgba(34,197,94,0.1)", borderWidth: 1,
    borderColor: "rgba(34,197,94,0.25)", alignItems: "center",
    justifyContent: "center", marginBottom: 20,
  },
  successCheckedIn: { color: "#22c55e", fontSize: 15, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 },
  successLane: { color: "#fff", fontSize: 40, fontWeight: "900", marginBottom: 4 },
  successGame: { color: "#555", fontSize: 16 },

  successActions: { gap: 12 },
  submitScoreBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, backgroundColor: "#06b6d4", borderRadius: 18,
    paddingVertical: 18,
  },
  submitScoreBtnText: { color: "#000", fontWeight: "900", fontSize: 17 },
  notNowBtn: {
    backgroundColor: "#111", borderRadius: 18, paddingVertical: 16,
    alignItems: "center", borderWidth: 1, borderColor: "#1e1e1e",
  },
  notNowText: { color: "#555", fontWeight: "700", fontSize: 15 },

  confirmOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.82)", alignItems: "center", justifyContent: "center", padding: 24 },
  confirmCard: { width: "100%", backgroundColor: "#111", borderRadius: 24, padding: 24, borderWidth: 1, borderColor: "#1f2937" },
  confirmIconWrap: { width: 58, height: 58, borderRadius: 18, backgroundColor: "rgba(6,182,212,0.12)", borderWidth: 1, borderColor: "rgba(6,182,212,0.25)", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  confirmEyebrow: { color: "#06b6d4", fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.1, marginBottom: 8 },
  confirmTitle: { color: "#fff", fontSize: 24, fontWeight: "900", lineHeight: 30, marginBottom: 10 },
  confirmSub: { color: "#777", fontSize: 14, lineHeight: 20, marginBottom: 22 },
  confirmActions: { flexDirection: "row", gap: 10 },
  confirmCancelBtn: { flex: 1, borderRadius: 16, backgroundColor: "#181818", borderWidth: 1, borderColor: "#242424", alignItems: "center", justifyContent: "center", paddingVertical: 15 },
  fullCancelBtn: { borderRadius: 16, backgroundColor: "#181818", borderWidth: 1, borderColor: "#242424", alignItems: "center", justifyContent: "center", paddingVertical: 15, marginTop: 12 },
  confirmCancelText: { color: "#888", fontSize: 14, fontWeight: "800" },
  confirmStartBtn: { flex: 1, borderRadius: 16, backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center", paddingVertical: 15, flexDirection: "row", gap: 8 },
  confirmStartText: { color: "#000", fontSize: 14, fontWeight: "900" },
  teamPickerList: { maxHeight: 260, marginBottom: 4 },
  teamPickerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#181818", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: "#242424", marginBottom: 8 },
  teamPickerName: { color: "#fff", fontSize: 15, fontWeight: "800", flex: 1 },
  noTeamsText: { color: "#777", fontSize: 14, lineHeight: 20, marginBottom: 8 },
});
