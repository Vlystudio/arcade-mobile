import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

type CheckInResult = {
  check_in_id: string;
  lane_id: string;
  lane_number: number;
  game_id: string;
  game_name: string;
  game_type: string;
  venue_id: string;
};

export default function ScanLaneScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkInResult, setCheckInResult] = useState<CheckInResult | null>(null);

  const extractToken = (data: string) => {
    try {
      const url = new URL(data);
      const t = url.searchParams.get("lane_token");
      if (t) return t;
    } catch { /* not a URL */ }
    return data.trim();
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

      // Show the success UI in-screen — no Alert navigation
      setCheckInResult({
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

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    handleCheckIn(data);
  };

  const handleScanAgain = () => {
    setCheckInResult(null);
    setScanned(false);
  };

  // ── Check-in success screen ───────────────────────────────────────────────

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
            onPress={() =>
              router.push({
                pathname: "/submit-score",
                params: {
                  lane_id:     checkInResult.lane_id,
                  lane_number: String(checkInResult.lane_number),
                  game_id:     checkInResult.game_id,
                  game_name:   checkInResult.game_name,
                  game_type:   checkInResult.game_type,
                  check_in_id: checkInResult.check_in_id,
                  venue_id:    checkInResult.venue_id,
                },
              })
            }
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

  if (!permission) {
    return (
      <SafeAreaView style={styles.centerPage}>
        <ActivityIndicator color="#06b6d4" />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
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
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
        />
        <View style={styles.overlay}>
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
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Scan Lane QR Code</Text>
        <Text style={styles.panelSub}>Point at the QR code posted on your lane</Text>

        {loading && (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#06b6d4" size="small" />
            <Text style={styles.statusText}>Checking in…</Text>
          </View>
        )}

        {scanned && !loading && (
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
      </View>
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

  panel: { backgroundColor: "#000", padding: 24, paddingBottom: 12 },
  panelTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  panelSub: { color: "#555", fontSize: 14, marginBottom: 16 },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  statusText: { color: "#888", fontSize: 14 },

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
});
