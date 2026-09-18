import { requireOptionalNativeModule } from "expo";
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useId, useState } from "react";
import { AppState, Platform } from "react-native";

type WakeLease = { release: () => Promise<void>; addEventListener: (event: "release", fn: () => void) => void };
type WakeNavigator = { wakeLock?: { request: (type: "screen") => Promise<WakeLease> } };
type NativeAwake = { activate: (tag: string) => Promise<void>; deactivate: (tag: string) => Promise<void> };

/** Uses Expo's already-bundled native module, with a graceful fallback on older builds. */
export function useScoringAwake(active: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState<"off" | "on" | "unavailable">("off");
  const focused = useIsFocused();
  const tag = useId();
  useEffect(() => {
    if (!active || !enabled || !focused) { setState("off"); return; }
    let disposed = false, generation = 0, lease: WakeLease | null = null;
    const native = Platform.OS === "web" ? null : requireOptionalNativeModule<NativeAwake>("ExpoKeepAwake");
    async function release() {
      generation++;
      const previous = lease; lease = null;
      await previous?.release().catch(() => {});
      if (native) await native.deactivate(tag).catch(() => {});
    }
    async function acquire() {
      const version = ++generation;
      if (disposed || AppState.currentState !== "active" || (Platform.OS === "web" && document.visibilityState !== "visible")) return;
      try {
        if (Platform.OS === "web") {
          const api = (navigator as WakeNavigator).wakeLock;
          if (!api) throw new Error("Unavailable");
          const next = await api.request("screen");
          if (disposed || version !== generation) { await next.release(); return; }
          lease = next;
          next.addEventListener("release", () => { if (!disposed && lease === next) { lease = null; setState("off"); } });
        } else {
          if (!native) throw new Error("Unavailable");
          await native.activate(tag);
          if (disposed || version !== generation) { await native.deactivate(tag); return; }
        }
        setState("on");
      } catch { if (!disposed && version === generation) setState("unavailable"); }
    }
    const visibility = () => { void release().then(acquire); };
    const subscription = AppState.addEventListener("change", visibility);
    if (Platform.OS === "web") document.addEventListener("visibilitychange", visibility);
    void acquire();
    return () => { disposed = true; void release(); subscription.remove(); if (Platform.OS === "web") document.removeEventListener("visibilitychange", visibility); };
  }, [active, enabled, focused, tag]);
  return { enabled, setEnabled, state };
}

