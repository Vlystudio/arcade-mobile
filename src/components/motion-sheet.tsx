import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "../context/motion-context";
import { MOTION } from "./motion";

/** Fade the scrim independently; keep the modal mounted until its exit completes. */
export function MotionSheet({ visible, onClose, children, style, accessibilityLabel }: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
}) {
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [present, setPresent] = useState(visible);
  const [lastVisibleChildren, setLastVisibleChildren] = useState(children);
  const progress = useRef(new Animated.Value(0)).current;
  const sheetStyle = StyleSheet.flatten(style);
  const padding = sheetStyle?.paddingBottom ?? sheetStyle?.paddingVertical ?? sheetStyle?.padding ?? 0;

  // Some callers clear their selected item when closing. Preserve its content
  // through the exit so the panel doesn't collapse or flash empty mid-animation.
  useLayoutEffect(() => {
    if (visible) setLastVisibleChildren(children);
  }, [children, visible]);

  useLayoutEffect(() => {
    if (visible && !present) { setPresent(true); return; }
    if (!present) return;
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reducedMotion ? 0 : visible ? MOTION.enter : MOTION.exit,
      easing: visible ? MOTION.easeOut : MOTION.easeIn,
      useNativeDriver: MOTION.nativeDriver, isInteraction: false,
    });
    animation.start(({ finished }) => { if (finished && !visible) setPresent(false); });
    return () => animation.stop();
  }, [present, progress, reducedMotion, visible]);

  return (
    <Modal visible={present} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, s.scrim, { opacity: progress }]} />
        <Pressable style={StyleSheet.absoluteFillObject} onPress={visible ? onClose : undefined} accessibilityRole="button" accessibilityLabel="Close sheet" />
        <Animated.View
          accessibilityLabel={accessibilityLabel}
          accessibilityViewIsModal
          pointerEvents={visible ? "auto" : "none"}
          style={[s.sheet, style, { paddingBottom: Math.max(typeof padding === "number" ? padding : 0, insets.bottom + 16), opacity: progress,
            transform: [{ translateY: reducedMotion ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [32, 0] }) }],
          }]}
        >
          <Pressable accessibilityRole="button" accessibilityLabel={`Close ${accessibilityLabel}`} onPress={onClose} style={s.close}>
            <Text style={s.closeText}>Close ×</Text>
          </Pressable>
          <ScrollView
            style={s.scroll}
            contentContainerStyle={{ gap: sheetStyle?.gap }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {visible ? children : lastVisibleChildren}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { backgroundColor: "rgba(0,0,0,0.75)" },
  sheet: { width: "100%", maxWidth: 560, maxHeight: "92%", alignSelf: "center", overflow: "hidden", backgroundColor: "#111", borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  close: { alignSelf: "flex-end", minHeight: 44, minWidth: 72, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  closeText: { color: "#cbd5e1", fontSize: 14, fontWeight: "700" },
  scroll: { flexGrow: 0 },
});
