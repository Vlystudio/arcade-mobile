import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

type ToastType = "success" | "error" | "info";
type ToastAction = { label: string; onPress: () => void };
type ToastItem = { id: number; message: string; type: ToastType; action?: ToastAction; durationMs?: number };

let nextId = 1;
let pushToast: ((t: ToastItem) => void) | null = null;
let dismissToast: ((id: number) => void) | null = null;

/** Show a non-blocking toast from anywhere: showToast("Invite sent"). */
export function showToast(message: string, type: ToastType = "success") {
  pushToast?.({ id: nextId++, message, type });
}

/** Toast with a tappable action (e.g. Undo). Stays up longer. */
export function showActionToast(message: string, actionLabel: string, onPress: () => void, durationMs = 5000) {
  const id = nextId++;
  pushToast?.({
    id, message, type: "info", durationMs,
    action: { label: actionLabel, onPress: () => { dismissToast?.(id); onPress(); } },
  });
}

const COLORS: Record<ToastType, { fg: string; icon: string }> = {
  success: { fg: "#22c55e", icon: "checkmark-circle" },
  error: { fg: "#ef4444", icon: "alert-circle" },
  info: { fg: "#06b6d4", icon: "information-circle" },
};

/** Render once near the root. Hosts the toast stack (max 3, auto-dismiss). */
export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    pushToast = (t) => {
      setToasts((prev) => [...prev.slice(-2), t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, t.durationMs ?? 2600);
    };
    dismissToast = (id) => setToasts((prev) => prev.filter((x) => x.id !== id));
    return () => { pushToast = null; dismissToast = null; };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <View style={s.host} pointerEvents="box-none">
      {toasts.map((t) => <ToastRow key={t.id} toast={t} />)}
    </View>
  );
}

function ToastRow({ toast }: { toast: ToastItem }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 220 }).start();
  }, []);
  const c = COLORS[toast.type];
  return (
    <Animated.View
      style={[s.toast, {
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
      }]}
    >
      <Ionicons name={c.icon as any} size={16} color={c.fg} />
      <Text style={s.text} numberOfLines={2}>{toast.message}</Text>
      {toast.action && (
        <Pressable onPress={toast.action.onPress} hitSlop={10}>
          <Text style={s.actionText}>{toast.action.label}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  host: {
    position: "absolute",
    bottom: 96,
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 8,
    zIndex: 9999,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(22,22,22,0.97)",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 11,
    maxWidth: 360,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  text: { color: "#fff", fontSize: 13.5, fontWeight: "600", flexShrink: 1 },
  actionText: { color: "#06b6d4", fontSize: 13.5, fontWeight: "900", marginLeft: 6, textTransform: "uppercase" },
});
