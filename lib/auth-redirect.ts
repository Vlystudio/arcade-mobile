import { Platform } from "react-native";

const configuredSiteUrl = process.env.EXPO_PUBLIC_SITE_URL;

function joinUrl(baseUrl: string, path: string) {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  return cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;
}

export function getEmailRedirectTo(path = "") {
  // Prefer the explicit site URL so the canonical www. domain is always used.
  // Falling back to window.location.origin would send users to the non-www
  // variant if they happened to navigate there, which has no SSL cert.
  if (configuredSiteUrl) {
    return joinUrl(configuredSiteUrl, path);
  }

  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    return joinUrl(window.location.origin, path);
  }

  return undefined;
}
