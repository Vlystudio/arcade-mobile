import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { TourStep } from "../../lib/tour-steps";

type Props = {
  visible: boolean;
  steps: TourStep[];
  onDone: () => void;
};

export function AppTour({ visible, steps, onDone }: Props) {
  const [index, setIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  const step = steps[index];
  const isLast = index === steps.length - 1;

  useEffect(() => {
    if (visible) {
      setIndex(0);
      fadeAnim.setValue(1);
      slideAnim.setValue(0);
    }
  }, [visible]);

  function animateToStep(nextIndex: number) {
    const direction = nextIndex > index ? 30 : -30;
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: direction, duration: 120, useNativeDriver: true }),
    ]).start(() => {
      setIndex(nextIndex);
      slideAnim.setValue(-direction);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 160, useNativeDriver: true }),
      ]).start();
    });
  }

  function handleNext() {
    if (isLast) { onDone(); return; }
    animateToStep(index + 1);
  }

  function handleBack() {
    if (index === 0) return;
    animateToStep(index - 1);
  }

  if (!step) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone}>
      <View style={s.overlay}>
        {/* Dismiss tap area behind card */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onDone} />

        <Animated.View
          style={[s.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
        >
          {/* Skip button */}
          <Pressable style={s.skipBtn} onPress={onDone} hitSlop={10}>
            <Text style={s.skipText}>Skip</Text>
          </Pressable>

          {/* Icon */}
          <View style={[s.iconCircle, { backgroundColor: step.iconColor + "18" }]}>
            <Ionicons
              name={step.icon as any}
              size={40}
              color={step.iconColor}
            />
          </View>

          {/* Tag + title */}
          {step.tag && (
            <View style={[s.tag, { backgroundColor: step.iconColor + "22", borderColor: step.iconColor + "44" }]}>
              <Text style={[s.tagText, { color: step.iconColor }]}>{step.tag.toUpperCase()}</Text>
            </View>
          )}
          <Text style={s.title}>{step.title}</Text>
          <Text style={s.body}>{step.body}</Text>

          {/* Step dots */}
          <View style={s.dots}>
            {steps.map((_, i) => (
              <View
                key={i}
                style={[
                  s.dot,
                  i === index && s.dotActive,
                  i === index && { backgroundColor: step.iconColor },
                ]}
              />
            ))}
          </View>

          {/* Navigation buttons */}
          <View style={s.btnRow}>
            {index > 0 ? (
              <Pressable style={s.backBtn} onPress={handleBack}>
                <Ionicons name="chevron-back" size={18} color="#555" />
                <Text style={s.backBtnText}>Back</Text>
              </Pressable>
            ) : (
              <View style={{ flex: 1 }} />
            )}

            <Pressable
              style={[s.nextBtn, { backgroundColor: step.iconColor }]}
              onPress={handleNext}
            >
              <Text style={s.nextBtnText}>{isLast ? "Get Started!" : "Next"}</Text>
              {!isLast && <Ionicons name="chevron-forward" size={16} color="#000" />}
            </Pressable>
          </View>

          {/* Step counter */}
          <Text style={s.counter}>{index + 1} of {steps.length}</Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.82)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },

  card: {
    backgroundColor: "#111",
    borderRadius: 28,
    padding: 28,
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    borderColor: "#1e1e1e",
    alignItems: "center",
    // Prevent dismiss tap from passing through
    pointerEvents: "box-none" as any,
  },

  skipBtn: {
    position: "absolute",
    top: 20,
    right: 20,
  },
  skipText: {
    color: "#777",
    fontSize: 13,
    fontWeight: "600",
  },

  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    marginTop: 8,
  },

  tag: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    marginBottom: 10,
  },
  tagText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: -0.3,
  },

  body: {
    color: "#888",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 28,
  },

  dots: {
    flexDirection: "row",
    gap: 5,
    marginBottom: 24,
    flexWrap: "wrap",
    justifyContent: "center",
    maxWidth: 280,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#2a2a2a",
  },
  dotActive: {
    width: 18,
    borderRadius: 3,
  },

  btnRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    gap: 12,
  },
  backBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "#1a1a1a",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  backBtnText: {
    color: "#8a8a8a",
    fontWeight: "700",
    fontSize: 14,
  },
  nextBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
  },
  nextBtnText: {
    color: "#000",
    fontWeight: "900",
    fontSize: 15,
  },

  counter: {
    color: "#333",
    fontSize: 11,
    marginTop: 16,
    fontWeight: "600",
  },
});
