import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

type ToastType = "success" | "error" | "info";
type ToastItem = { id: number; message: string; type: ToastType };

let nextId = 1;
let pushToast: ((t: ToastItem) => void) | null = null;

/** Show a non-blocking toast from anywhere: showToast("Invite sent"). */
export function showToast(message: string, type: ToastType = "success") {
  pushToast?.({ id: nextId++, message, type });
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
      }, 2600);
    };
    return () => { pushToast = null; };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <View style={s.host} pointerEvents="none">
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
});
