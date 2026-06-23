// Lightweight haptics that work on the web/PWA build without a native module.
// Uses the Vibration API where available (Android Chrome); on iOS Safari and
// anywhere without support it silently no-ops. Kept dependency-free so it works
// in the current web build; can later be upgraded to expo-haptics on native.

type Pattern = "tap" | "light" | "success" | "warning" | "error";

const PATTERNS: Record<Pattern, number | number[]> = {
  tap: 8,
  light: 12,
  success: [10, 40, 18],
  warning: [16, 50, 16],
  error: [22, 40, 22, 40, 22],
};

export function haptic(kind: Pattern = "tap") {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(PATTERNS[kind]);
    }
  } catch {
    // ignore — haptics are a nicety, never block on them
  }
}
