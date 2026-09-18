import AsyncStorage from "@react-native-async-storage/async-storage";

export type RecentGroup = { version: 1; teamId: string; lineup: string[]; updatedAt: number };
const key = (userId: string, teamId: string) => `@arcade:recent-group:v1:${userId}:${teamId}`;
export function validRecentGroup(raw: string | null, teamId: string, members: string[], userId: string): string[] | null {
  try {
    const value = JSON.parse(raw ?? "null") as RecentGroup | null;
    if (!value || value.version !== 1 || value.teamId !== teamId || !Array.isArray(value.lineup)
      || value.lineup.length < 1 || value.lineup.length > 3 || new Set(value.lineup).size !== value.lineup.length
      || !value.lineup.includes(userId) || value.lineup.some(id => !members.includes(id))) return null;
    return value.lineup;
  } catch { return null; }
}
export async function readRecentGroup(userId: string, teamId: string, members: string[]) {
  return validRecentGroup(await AsyncStorage.getItem(key(userId, teamId)).catch(() => null), teamId, members, userId);
}
export async function rememberGroup(userId: string, teamId: string, lineup: string[]) {
  const value: RecentGroup = { version: 1, teamId, lineup, updatedAt: Date.now() };
  await AsyncStorage.setItem(key(userId, teamId), JSON.stringify(value));
  await AsyncStorage.setItem(`@arcade:recent-team:v1:${userId}`, teamId);
}

