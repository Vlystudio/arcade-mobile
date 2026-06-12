import { Ionicons } from "@expo/vector-icons";
import html2canvas from "html2canvas";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getLastErrorAt, onErrorSignal } from "../lib/error-signal";

type PreviewState = {
  dataUrl: string;
  blob: Blob;
};

// Only show the camera for a short window after the user hits an error,
// so it doesn't cover UI during normal use.
const ERROR_WINDOW_MS = 90_000;

export function ScreenshotButton() {
  const [capturing, setCapturing] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [copied, setCopied] = useState(false);
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
    if (preview) {
      dismissTimer.current = setTimeout(() => setPreview(null), 8000);
    }
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [preview]);

  async function capture() {
    if (capturing) return;
    setCapturing(true);
    setPreview(null);
    try {
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: false,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        logging: false,
        imageTimeout: 0,
        backgroundColor: "#000000",
      });

      const dataUrl = canvas.toDataURL("image/png");
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/png",
        ),
      );
      setPreview({ dataUrl, blob });
    } catch (e) {
      console.error("[screenshot]", e);
    } finally {
      setCapturing(false);
    }
  }

  function download() {
    if (!preview) return;
    const a = document.createElement("a");
    a.href = preview.dataUrl;
    a.download = `arcade-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function copyToClipboard() {
    if (!preview) return;
    try {
      // ClipboardItem requires secure context (HTTPS) — works on modern browsers
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": preview.blob }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback: open in new tab so user can save manually
      window.open(preview.dataUrl, "_blank");
    }
  }

  function dismiss() {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setPreview(null);
    setCopied(false);
  }

  // Hidden during normal use — appears only in the post-error window
  // (keep rendering while a captured preview is on screen).
  if (!visible && !preview) return null;

  return (
    <>
      {/* Corner preview card — appears after capture, like iOS */}
      {preview && (
        <View style={s.previewCard}>
          <Pressable style={s.previewDismiss} onPress={dismiss} hitSlop={8}>
            <Ionicons name="close-circle" size={20} color="rgba(255,255,255,0.6)" />
          </Pressable>
          <Image
            source={{ uri: preview.dataUrl }}
            style={s.previewThumb}
            resizeMode="cover"
          />
          <View style={s.previewActions}>
            <Pressable style={s.previewActionBtn} onPress={download}>
              <Ionicons name="download-outline" size={14} color="#fff" />
              <Text style={s.previewActionText}>Save</Text>
            </Pressable>
            <View style={s.previewDivider} />
            <Pressable style={s.previewActionBtn} onPress={copyToClipboard}>
              <Ionicons
                name={copied ? "checkmark" : "copy-outline"}
                size={14}
                color={copied ? "#22c55e" : "#fff"}
              />
              <Text style={[s.previewActionText, copied && { color: "#22c55e" }]}>
                {copied ? "Copied!" : "Copy"}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Floating camera button */}
      <Pressable
        style={[s.fab, capturing && { opacity: 0.75 }]}
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
    </>
  );
}

const s = StyleSheet.create({
  fab: {
    position: "fixed" as any,
    bottom: 24,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(30,30,30,0.88)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    // Web-only shadow
    ...(typeof window !== "undefined"
      ? ({ boxShadow: "0 4px 20px rgba(0,0,0,0.5)" } as any)
      : {}),
    zIndex: 9999,
    backdropFilter: "blur(8px)" as any,
    WebkitBackdropFilter: "blur(8px)" as any,
  },

  /* iOS-style corner preview card */
  previewCard: {
    position: "fixed" as any,
    bottom: 80,
    right: 20,
    width: 160,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    zIndex: 9998,
    ...(typeof window !== "undefined"
      ? ({ boxShadow: "0 8px 32px rgba(0,0,0,0.6)" } as any)
      : {}),
  },
  previewDismiss: {
    position: "absolute" as any,
    top: 6,
    right: 6,
    zIndex: 10,
  },
  previewThumb: {
    width: "100%" as any,
    height: 120,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
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
  previewDivider: {
    width: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
});
