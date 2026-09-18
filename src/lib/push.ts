import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "../../lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

let registeredFor: string | null = null;
const TOKEN_KEY = "@arcade:pushToken";
const DEVICE_SECRET_KEY = "@arcade:pushDeviceSecret";

/** Remove the token while the departing user's credentials still authorize it. */
let deviceWork: Promise<unknown> = Promise.resolve();
function serialDeviceWork(work: () => Promise<void>) {
  const next = deviceWork.then(work, work);
  deviceWork = next.catch(() => {});
  return next;
}
export function unregisterForPush() { return serialDeviceWork(unregisterDevice); }
export function registerForPush(userId: string) { return serialDeviceWork(() => registerDevice(userId)); }
async function unregisterDevice() {
  registeredFor = null;
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  const { error } = await supabase.from("push_tokens").delete().eq("token", token);
  if (error) throw error;
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/**
 * Register this device for push notifications and store the Expo token.
 *
 * Loaded with a guarded require so it safely no-ops on:
 * - web (no native push)
 * - binaries built before expo-notifications was added (OTA updates reach
 *   them, but the native module is missing — calls would throw)
 */
async function registerDevice(userId: string) {
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

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user.id !== userId) return;
    let secret = await AsyncStorage.getItem(DEVICE_SECRET_KEY);
    if (!secret) {
      secret = Crypto.randomUUID() + Crypto.randomUUID();
      await AsyncStorage.setItem(DEVICE_SECRET_KEY, secret);
    }
    const { error } = await supabase.rpc("register_device_push_token", {
      p_token: token, p_secret: secret, p_platform: Platform.OS,
    });
    if (error) throw error;
    await AsyncStorage.setItem(TOKEN_KEY, token);
    const { data: { session: current } } = await supabase.auth.getSession();
    if (current?.user.id === userId) registeredFor = userId;
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
