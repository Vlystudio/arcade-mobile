import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "../../lib/supabase";

let registeredFor: string | null = null;

/**
 * Register this device for push notifications and store the Expo token.
 *
 * Loaded with a guarded require so it safely no-ops on:
 * - web (no native push)
 * - binaries built before expo-notifications was added (OTA updates reach
 *   them, but the native module is missing — calls would throw)
 */
export async function registerForPush(userId: string) {
  if (Platform.OS === "web" || registeredFor === userId) return;

  let Notifications: any;
  let Device: any;
  try {
    Notifications = require("expo-notifications");
    Device = require("expo-device");
  } catch {
    return; // native module not in this binary
  }

  try {
    if (!Device.isDevice) return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "League & Activity",
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: "#06b6d4",
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return;

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token: string | undefined = tokenResult?.data;
    if (!token) return;

    await supabase.from("push_tokens").upsert(
      {
        token,
        user_id: userId,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );
    registeredFor = userId;
  } catch {
    // Push is best-effort; never let registration break the app
  }
}

/** Foreground notification behavior: show banners while the app is open. */
export function configureNotificationHandler() {
  if (Platform.OS === "web") return;
  try {
    const Notifications = require("expo-notifications");
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // native module not in this binary
  }
}
