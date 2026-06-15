import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { getTourSteps, tourStorageKey, type TourStep } from "../../lib/tour-steps";
import { useAuth } from "../context/auth-context";
import type { AppRole } from "./role-badge";
import { supabase } from "../../lib/supabase";

// Toast-style global controller so the tour can be launched from any screen
// and — crucially — survive navigation, since it's mounted once at the root.
type ActiveTour = { steps: TourStep[]; onDone?: () => void };
let pushTour: ((t: ActiveTour) => void) | null = null;

/** Start (or restart) the interactive walkthrough from anywhere. */
export function startGuidedTour(steps: TourStep[], onDone?: () => void) {
  pushTour?.({ steps, onDone });
}

/**
 * Root-mounted overlay. Renders a floating bottom card that leaves the real
 * screen visible above it, and navigates the user to each step's route so
 * they see exactly what's being explained.
 */
export function GuidedTourHost() {
  const [tour, setTour] = useState<ActiveTour | null>(null);
  const [index, setIndex] = useState(0);
  const pathname = usePathname();
  const { user } = useAuth();
  const autoRef = useRef(false);
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    pushTour = (t) => { setTour(t); setIndex(0); };
    return () => { pushTour = null; };
  }, []);

  // First-launch auto-start lives ONLY here (single root mount), so screens
  // mounting/unmounting during the tour can never re-trigger it.
  useEffect(() => {
    if (!user?.id || autoRef.current) return;
    autoRef.current = true;
    const key = tourStorageKey(user.id);
    AsyncStorage.getItem(key).then(async (val) => {
      if (val) return;
      let role: AppRole = "user";
      try {
        const { data } = await supabase.from("profiles").select("role").eq("id", user.id).single();
        role = ((data as any)?.role ?? "user") as AppRole;
      } catch { /* default user */ }
      startGuidedTour(getTourSteps(role), () => AsyncStorage.setItem(key, "done").catch(() => {}));
    });
  }, [user?.id]);

  const step = tour?.steps[index];

  // Navigate to the step's screen when it changes.
  useEffect(() => {
    if (!tour || !step?.route) return;
    if (pathname !== step.route) {
      try { router.replace(step.route as any); } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, index]);

  // Animate the card in on each step.
  useEffect(() => {
    if (!tour) return;
    fade.setValue(0); slide.setValue(40);
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(slide, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 200 }),
    ]).start();
  }, [tour, index]);

  if (!tour || !step) return null;

  const isLast = index === tour.steps.length - 1;
  const accent = step.iconColor;

  function finish() {
    tour?.onDone?.();
    setTour(null);
    setIndex(0);
  }
  function next() { if (isLast) finish(); else setIndex((i) => i + 1); }
  function back() { if (index > 0) setIndex((i) => i - 1); }

  return (
    // box-none lets the user still tap the real screen above the card.
    <View style={s.layer} pointerEvents="box-none">
      <Animated.View style={[s.card, { opacity: fade, transform: [{ translateY: slide }] }]}>
        <View style={s.headerRow}>
          <View style={[s.iconCircle, { backgroundColor: accent + "1e", borderColor: accent + "44" }]}>
            <Ionicons name={step.icon as any} size={20} color={accent} />
          </View>
          {step.tag && (
            <View style={[s.tag, { backgroundColor: accent + "1e", borderColor: accent + "44" }]}>
              <Text style={[s.tagText, { color: accent }]}>{step.tag.toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <Pressable onPress={finish} hitSlop={10} style={s.skipBtn}>
            <Text style={s.skipText}>Skip</Text>
          </Pressable>
        </View>

        <Text style={s.title}>{step.title}</Text>
        <Text style={s.body}>{step.body}</Text>

        {/* Progress dots */}
        <View style={s.dots}>
          {tour.steps.map((_, i) => (
            <View key={i} style={[s.dot, i === index && [s.dotActive, { backgroundColor: accent }]]} />
          ))}
        </View>

        <View style={s.btnRow}>
          {index > 0 ? (
            <Pressable style={s.backBtn} onPress={back}>
              <Ionicons name="chevron-back" size={17} color="#9a9a9a" />
              <Text style={s.backText}>Back</Text>
            </Pressable>
          ) : <View style={{ flex: 1 }} />}

          <Text style={s.counter}>{index + 1} / {tour.steps.length}</Text>

          <Pressable style={[s.nextBtn, { backgroundColor: accent }]} onPress={next}>
            <Text style={s.nextText}>{isLast ? "Done" : "Next"}</Text>
            {!isLast && <Ionicons name="chevron-forward" size={16} color="#000" />}
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  layer: {
    position: "absolute",
    left: 0, right: 0, bottom: 0, top: 0,
    justifyContent: "flex-end",
    zIndex: 10000,
    // @ts-ignore web
    ...(Platform.OS === "web" ? { position: "fixed" as any } : null),
  },
  card: {
    backgroundColor: "#141414",
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderRadius: 24,
    marginHorizontal: 10,
    marginBottom: Platform.OS === "web" ? 16 : 92, // float above the tab bar
    padding: 20,
    borderWidth: 1, borderColor: "#262626",
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.5, shadowRadius: 24,
    elevation: 16,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  iconCircle: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  tag: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1 },
  tagText: { fontSize: 9.5, fontWeight: "900", letterSpacing: 1 },
  skipBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  skipText: { color: "#8a8a8a", fontSize: 13, fontWeight: "700" },

  title: { color: "#fff", fontSize: 19, fontWeight: "900", letterSpacing: -0.2, marginBottom: 8 },
  body: { color: "#a8a8a8", fontSize: 14, lineHeight: 21, marginBottom: 16 },

  dots: { flexDirection: "row", gap: 5, flexWrap: "wrap", marginBottom: 16 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#2c2c2c" },
  dotActive: { width: 16 },

  btnRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingVertical: 12, paddingHorizontal: 16,
    backgroundColor: "#1c1c1c", borderRadius: 14, borderWidth: 1, borderColor: "#2a2a2a",
  },
  backText: { color: "#9a9a9a", fontWeight: "700", fontSize: 14 },
  counter: { flex: 1, textAlign: "center", color: "#666", fontSize: 12, fontWeight: "700" },
  nextBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    paddingVertical: 13, paddingHorizontal: 26, borderRadius: 14, minWidth: 110,
  },
  nextText: { color: "#000", fontWeight: "900", fontSize: 15 },
});
