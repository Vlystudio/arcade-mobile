import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Platform } from "react-native";

// Start without motion until the preference is known (also safe during SSR).
const ReducedMotionContext = createContext(true);

export function MotionProvider({ children }: { children: ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = () => setReducedMotion(preference.matches);
      update();
      preference.addEventListener("change", update);
      return () => preference.removeEventListener("change", update);
    }

    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", value => {
      changed = true;
      setReducedMotion(value);
    });
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active && !changed) setReducedMotion(value);
    }).catch(() => { /* Keep motion disabled when the preference is unavailable. */ });
    return () => { active = false; subscription.remove(); };
  }, []);

  return <ReducedMotionContext value={reducedMotion}>{children}</ReducedMotionContext>;
}

export function useReducedMotion() {
  return useContext(ReducedMotionContext);
}
