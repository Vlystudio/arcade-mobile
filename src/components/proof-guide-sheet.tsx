import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Framing guide shown right before the score-proof camera opens. A reticle
 * mock + a short checklist so people capture a clean, readable shot of the
 * machine's score screen the first time — cuts down on blurry/cropped proofs
 * that fail verification. Confirm proceeds to the camera.
 */
export function ProofGuideSheet({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.overlay}>
        <View style={s.card}>
          <Text style={s.title}>Line up the score</Text>

          {/* Reticle mock */}
          <View style={s.viewfinder}>
            <View style={[s.corner, s.tl]} />
            <View style={[s.corner, s.tr]} />
            <View style={[s.corner, s.bl]} />
            <View style={[s.corner, s.br]} />
            <Text style={s.viewfinderScore}>1,250</Text>
            <Text style={s.viewfinderHint}>fill the frame with the screen</Text>
          </View>

          <View style={s.tips}>
            <Tip icon="scan-outline" text="Fill the frame with the machine's score display" />
            <Tip icon="sunny-outline" text="Good light, and avoid glare on the screen" />
            <Tip icon="eye-outline" text="Make sure the number is sharp and readable" />
          </View>

          <Pressable style={s.confirm} onPress={onConfirm}>
            <Ionicons name="camera" size={18} color="#001016" />
            <Text style={s.confirmText}>Open camera</Text>
          </Pressable>
          <Pressable style={s.cancel} onPress={onCancel} hitSlop={8}>
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Tip({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={s.tipRow}>
      <Ionicons name={icon} size={16} color="#06b6d4" />
      <Text style={s.tipText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 360, backgroundColor: "#0e0e0e", borderColor: "#222", borderWidth: 1, borderRadius: 22, padding: 22 },
  title: { color: "#fff", fontSize: 18, fontWeight: "900", textAlign: "center", marginBottom: 16 },
  viewfinder: {
    height: 150, borderRadius: 14, backgroundColor: "#060606",
    alignItems: "center", justifyContent: "center", marginBottom: 18, overflow: "hidden",
  },
  corner: { position: "absolute", width: 26, height: 26, borderColor: "#06b6d4" },
  tl: { top: 14, left: 14, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
  tr: { top: 14, right: 14, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
  bl: { bottom: 14, left: 14, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
  br: { bottom: 14, right: 14, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },
  viewfinderScore: { color: "#fff", fontSize: 40, fontWeight: "900", letterSpacing: 1 },
  viewfinderHint: { color: "#555", fontSize: 11, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  tips: { gap: 11, marginBottom: 20 },
  tipRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  tipText: { color: "#bdbdbd", fontSize: 13.5, flex: 1, lineHeight: 18 },
  confirm: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9,
    backgroundColor: "#06b6d4", borderRadius: 999, paddingVertical: 14,
  },
  confirmText: { color: "#001016", fontSize: 15, fontWeight: "800" },
  cancel: { alignItems: "center", paddingVertical: 12, marginTop: 2 },
  cancelText: { color: "#777", fontSize: 14, fontWeight: "600" },
});
