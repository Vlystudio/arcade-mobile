import { Platform } from "react-native";

// Web: relative URL so fetch always goes to the current origin (www or local dev).
// Native: needs an absolute URL — read from env.
export const API_BASE =
  Platform.OS === "web" ? "" : (process.env.EXPO_PUBLIC_API_BASE_URL ?? "");
