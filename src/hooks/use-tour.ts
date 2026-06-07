import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { tourStorageKey } from "../../lib/tour-steps";

export function useTour(userId: string | undefined) {
  const [tourVisible, setTourVisible] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!userId) return;
    AsyncStorage.getItem(tourStorageKey(userId)).then((val) => {
      if (!val) setTourVisible(true);
      setChecked(true);
    });
  }, [userId]);

  async function dismissTour() {
    setTourVisible(false);
    if (userId) {
      await AsyncStorage.setItem(tourStorageKey(userId), "done");
    }
  }

  async function replayTour() {
    if (userId) {
      await AsyncStorage.removeItem(tourStorageKey(userId));
    }
    setTourVisible(true);
  }

  return { tourVisible, checked, dismissTour, replayTour };
}
