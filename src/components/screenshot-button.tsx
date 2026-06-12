import { Ionicons } from "@expo/vector-icons";
import * as MediaLibrary from "expo-media-library";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { captureScreen } from "react-native-view-shot";
import { getLastErrorAt, onErrorSignal } from "../lib/error-signal";

// Only show the camera for a short window after the user hits an error,
// so it doesn't cover UI during normal use.
const ERROR_WINDOW_MS = 90_000;

export function ScreenshotButton() {
  const [capturing, setCapturing] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [visible, setVisible] = useState(Date.now() - getLastErrorAt() < ERROR_WINDOW_MS);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const show = () => {
      setVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), ERROR_WINDOW_MS);
    };
    if (Date.now() - getLastErrorAt() < ERROR_WINDOW_MS) show();
    const off = onErrorSignal(show);
    return () => {
      off();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // Auto-dismiss preview after 8 seconds
  useEffect(() => {
    if (previewUri) {
      dismissTimer.current = setTimeout(dismissPreview, 8000);
    }
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [previewUri]);

  async function capture() {
    if (capturing) return;
    setCapturing(true);
    dismissPreview();
    try {
      const uri = await captureScreen({ format: "png", quality: 1 });
      setPreviewUri(uri);
    } catch (e) {
      console.error("[screenshot]", e);
      Alert.alert("Screenshot failed", "Please try again.");
    } finally {
      setCapturing(false);
    }
  }

  async function saveToLibrary() {
    if (!previewUri || saving) return;
    setSaving(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Allow photo library access to save screenshots.",
        );
        return;
      }
      await MediaLibrary.saveToLibraryAsync(previewUri);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      Alert.alert("Save failed", "Couldn't save to camera roll. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function dismissPreview() {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setPreviewUri(null);
    setSaved(false);
  }

  // Hidden during normal use — appears only in the post-error window
  // (keep rendering while a captured preview is on screen).
  if (!visible && !previewUri) return null;

  // The transparent Modal is the only reliable way to render above react-native-screens
  // on both iOS (UIViewController) and Android (Fragment). We manually forward the
  // Android hardware back button to Expo Router so navigation still works normally.
  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => {
        // Android hardware back: forward to router so navigation works as normal
        if (router.canGoBack()) {
          router.back();
        } else {
          BackHandler.exitApp();
        }
      }}
    >
      {/* box-none: the overlay itself doesn't capture touches — only child Pressables do */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">

        {/* iOS-style corner preview card */}
        {previewUri && (
          <View style={s.previewCard}>
            <Pressable style={s.previewDismiss} onPress={dismissPreview} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color="rgba(255,255,255,0.6)" />
            </Pressable>
            <Image
              source={{ uri: previewUri }}
              style={s.previewThumb}
              resizeMode="cover"
            />
            <View style={s.previewActions}>
              <Pressable
                style={s.previewActionBtn}
                onPress={saveToLibrary}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons
                    name={saved ? "checkmark" : "download-outline"}
                    size={14}
                    color={saved ? "#22c55e" : "#fff"}
                  />
                )}
                <Text style={[s.previewActionText, saved && { color: "#22c55e" }]}>
                  {saved ? "Saved!" : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Floating camera button */}
        <Pressable
          style={[s.fab, capturing && { opacity: 0.7 }]}
          onPress={capture}
          disabled={capturing}
          accessibilityLabel="Take screenshot"
          accessibilityRole="button"
        >
          {capturing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="camera-outline" size={20} color="#fff" />
          )}
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  fab: {
    position: "absolute",
    bottom: 36,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(30,30,30,0.88)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
  },

  previewCard: {
    position: "absolute",
    bottom: 92,
    right: 20,
    width: 160,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    elevation: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
  },
  previewDismiss: {
    position: "absolute",
    top: 6,
    right: 6,
    zIndex: 10,
  },
  previewThumb: {
    width: "100%",
    height: 120,
  },
  previewActions: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  previewActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 10,
  },
  previewActionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
});
