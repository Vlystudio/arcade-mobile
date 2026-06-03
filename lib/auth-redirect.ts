import { Platform } from "react-native";

const configuredSiteUrl = process.env.EXPO_PUBLIC_SITE_URL;

function joinUrl(baseUrl: string, path: string) {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  return cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;
}

export function getEmailRedirectTo(path = "") {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    return joinUrl(window.location.origin, path);
  }

  if (configuredSiteUrl) {
    return joinUrl(configuredSiteUrl, path);
  }

  return undefined;
}
