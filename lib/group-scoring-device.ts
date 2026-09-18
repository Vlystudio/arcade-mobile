import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";

const pending = new Map<string, Promise<string>>();
export function groupScoringDeviceKey(userId: string): Promise<string> {
  const existing = pending.get(userId);
  if (existing) return existing;
  const load = (async () => {
    const storageKey = `@arcade:group-scoring-device:v1:${userId}`;
    const saved = await AsyncStorage.getItem(storageKey);
    if (saved) return saved;
    const key = randomUUID() + randomUUID();
    await AsyncStorage.setItem(storageKey, key);
    return key;
  })();
  pending.set(userId, load);
  void load.catch(() => pending.delete(userId));
  return load;
}

export type GroupControl = {
  ok: boolean; claimed: boolean; can_score: boolean; owner_id: string | null; owner_name: string | null;
  balls: import("./group-scoring").GroupBall[]; revision: number; status: string;
};
