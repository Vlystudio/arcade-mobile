import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect } from "react";
import { getTourSteps, tourStorageKey } from "../../lib/tour-steps";
import { startGuidedTour } from "../components/guided-tour";
import type { AppRole } from "../components/role-badge";

// Module-level guard: the first-launch auto-start must fire ONCE per app
// session, not on every screen mount. Without this, the tour navigating onto
// a screen that also calls useTour (e.g. /profile) would re-trigger the
// auto-start and reset the tour to step 0.
let autoStartHandled = false;

/**
 * Drives the interactive walkthrough. Auto-starts once on first launch and
 * exposes replay(). The overlay itself lives at the root (GuidedTourHost),
 * so it survives the navigation the tour performs.
 */
export function useTour(userId: string | undefined, role: AppRole = "user") {
  useEffect(() => {
    if (!userId || autoStartHandled) return;
    autoStartHandled = true; // claim synchronously to prevent re-entry mid-tour
    const key = tourStorageKey(userId);
    AsyncStorage.getItem(key).then((val) => {
      if (!val) {
        startGuidedTour(getTourSteps(role), () => AsyncStorage.setItem(key, "done").catch(() => {}));
      }
    });
  }, [userId, role]);

  function replay() {
    startGuidedTour(getTourSteps(role));
  }

  return { replay };
}
