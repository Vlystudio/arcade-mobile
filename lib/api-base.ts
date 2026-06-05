import { Platform } from "react-native";

// If EXPO_PUBLIC_API_BASE_URL is set at build time (Vercel env var), use it
// everywhere — this ensures API calls always reach the correct deployment even
// when the HTML is served from a different domain (e.g. http://vlystudios.com).
// Without it, web falls back to relative URLs (same-origin, works on www) and
// native falls back to empty string (must be set for native builds).
export const API_BASE: string =
  (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ??
  (Platform.OS === "web" ? "" : "");
