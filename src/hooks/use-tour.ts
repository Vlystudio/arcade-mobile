import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef } from "react";
import { getTourSteps, tourStorageKey } from "../../lib/tour-steps";
import { startGuidedTour } from "../components/guided-tour";
import type { AppRole } from "../components/role-badge";

/**
 * Drives the interactive walkthrough. Auto-starts once on first launch and
 * exposes replay(). The overlay itself lives at the root (GuidedTourHost),
 * so it survives the navigation the tour performs.
 */
export function useTour(userId: string | undefined, role: AppRole = "user") {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!userId || startedRef.current) return;
    const key = tourStorageKey(userId);
    AsyncStorage.getItem(key).then((val) => {
      if (!val) {
        startedRef.current = true;
        startGuidedTour(getTourSteps(role), () => AsyncStorage.setItem(key, "done").catch(() => {}));
      }
    });
  }, [userId, role]);

  function replay() {
    startGuidedTour(getTourSteps(role));
  }

  return { replay };
}
