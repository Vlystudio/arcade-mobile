import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";
import { AppState } from "react-native";
import { supabase } from "./supabase";

export type BallSubmission = { player_user_id: string; ball_number: number; score: number };
export type PendingSubmit = {
  session_id: string; balls: BallSubmission[]; ts: number; revision: string; last_error?: string;
};
const storageKey = (userId: string) => `pending_skee_submits_v2:${userId}`;
const LEGACY_KEY = "pending_skee_submits_v1"; // gitleaks:allow -- AsyncStorage key, not a credential.
// Serialize storage mutations, but never hold this lock during a network request.
let storageWork: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = storageWork.then(work, work);
  storageWork = result.catch(() => {});
  return result;
}
async function read(userId: string): Promise<PendingSubmit[]> {
  const raw = await AsyncStorage.getItem(storageKey(userId));
  const value: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(value)) throw new Error("Saved scores could not be read. Please contact support.");
  return value;
}
function write(userId: string, items: PendingSubmit[]) {
  return AsyncStorage.setItem(storageKey(userId), JSON.stringify(items));
}
export function queueSubmit(userId: string, p: Pick<PendingSubmit, "session_id" | "balls">) {
  if (!userId) return Promise.reject(new Error("Sign in before saving scores."));
  return exclusive(async () => {
    const list = await read(userId);
    const ts = Date.now();
    const next = list.filter((x) => x.session_id !== p.session_id);
    next.push({ ...p, ts, revision: `${ts}-${Math.random().toString(36).slice(2)}` });
    await write(userId, next);
  });
}
export function pendingSubmissions(userId: string): Promise<PendingSubmit[]> {
  return exclusive(() => read(userId));
}
export async function pendingCount(userId: string): Promise<number> {
  return (await pendingSubmissions(userId)).length;
}
/** Preserve old entries until this account's session participation is verified. */
export async function recoverLegacySubmissions(userId: string) {
  const raw = await AsyncStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  const legacy: { session_id: string; balls: BallSubmission[]; ts: number }[] = JSON.parse(raw);
  if (!Array.isArray(legacy)) throw new Error("Older saved scores need support recovery.");
  for (const item of legacy) {
    const { data, error } = await supabase.from("skeeball_session_players").select("session_id")
      .eq("session_id", item.session_id).eq("player_user_id", userId).maybeSingle();
    if (error || !data) continue;
    await exclusive(async () => {
      const current = await read(userId);
      if (!current.some((entry) => entry.session_id === item.session_id)) {
        await write(userId, [...current, { ...item, revision: `legacy-${item.ts}` }]);
      }
      const remaining = JSON.parse(await AsyncStorage.getItem(LEGACY_KEY) ?? "[]") as typeof legacy;
      await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(remaining.filter((entry) =>
        entry.session_id !== item.session_id || entry.ts !== item.ts)));
    });
  }
}
export function looksOffline(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = err && typeof err === "object" && "message" in err ? err.message : err;
  return /network|fetch|timeout|offline|connection/i.test(String(message ?? ""));
}
const flushing = new Map<string, Promise<number>>();
export function flushQueue(userId: string): Promise<number> {
  const active = flushing.get(userId);
  if (active) return active;
  const work = flush(userId).finally(() => flushing.delete(userId));
  flushing.set(userId, work);
  return work;
}
async function flush(userId: string): Promise<number> {
  let done = 0;
  for (const item of await pendingSubmissions(userId)) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user.id !== userId) break;
    let failure: string | undefined;
    try {
      const { data, error } = await supabase.rpc("rpc_skeeball_submit_and_complete", {
        p_session_id: item.session_id, p_balls: item.balls,
      });
      if (error || data?.error || data?.ok !== true) {
        failure = error?.message ?? data?.message ?? "Scores are still pending. Retry when connected.";
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : "Connection failed. Scores remain saved.";
    }
    await exclusive(async () => {
      const current = await read(userId);
      const matches = (x: PendingSubmit) => x.session_id === item.session_id && x.revision === item.revision;
      await write(userId, failure
        ? current.map((x) => matches(x) ? { ...x, last_error: failure } : x)
        : current.filter((x) => !matches(x)));
    });
    if (!failure) done++;
  }
  return done;
}
/** Install only after auth restoration; dispose when the account changes. */
export function initOfflineFlush(userId: string, onError: (error: unknown) => void = console.warn) {
  const retry = () => { void recoverLegacySubmissions(userId).catch(onError).then(() => flushQueue(userId)).catch(onError); };
  retry();
  const app = AppState.addEventListener("change", (state) => { if (state === "active") retry(); });
  const network = Network.addNetworkStateListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) retry();
  });
  return () => { app.remove(); network.remove(); };
}
