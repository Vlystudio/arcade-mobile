import { getTourSteps } from "../../lib/tour-steps";
import { startGuidedTour } from "../components/guided-tour";
import type { AppRole } from "../components/role-badge";

/**
 * Replay-only handle for the walkthrough. First-launch auto-start is owned by
 * the root GuidedTourHost (single mount), so it can't be re-triggered by
 * screens mounting mid-tour. This just exposes a manual replay() for the
 * "How to Use This App" button.
 */
export function useTour(_userId?: string, role: AppRole = "user") {
  function replay() {
    startGuidedTour(getTourSteps(role));
  }
  return { replay };
}
