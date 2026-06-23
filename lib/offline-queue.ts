import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

// Offline-resilient skee-ball submission. Venues have spotty Wi-Fi, and a
// full game's balls are entered locally then submitted in one shot — if that
// submit fails on a dropped connection the scores would be lost. Instead we
// stash the payload here and flush it automatically when connectivity returns.

const KEY = "pending_skee_submits_v1";

export type PendingSubmit = { session_id: string; balls: any[]; ts: number };

async function read(): Promise<PendingSubmit[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingSubmit[]) : [];
  } catch {
    return [];
  }
}

async function write(list: PendingSubmit[]) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

/** Save a submission to retry later. De-dupes by session_id (latest wins). */
export async function queueSubmit(p: Omit<PendingSubmit, "ts">) {
  const list = await read();
  const next = list.filter((x) => x.session_id !== p.session_id);
  next.push({ ...p, ts: Date.now() });
  await write(next);
}

export async function pendingCount(): Promise<number> {
  return (await read()).length;
}

/** Treat a thrown submit error as "we're offline" vs a real server rejection. */
export function looksOffline(err: any): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const m = String(err?.message ?? err ?? "").toLowerCase();
  return /network|fetch|failed to fetch|timeout|offline|connection/.test(m);
}

let flushing = false;

/** Try to submit every queued game. Returns how many succeeded. */
export async function flushQueue(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let done = 0;
  try {
    const list = await read();
    if (list.length === 0) return 0;
    const remaining: PendingSubmit[] = [];
    for (const item of list) {
      try {
        const { data, error } = await supabase.rpc("rpc_skeeball_submit_balls", {
          p_session_id: item.session_id,
          p_balls: item.balls,
        });
        // Keep it queued only if the failure looks like a network problem.
        // A server rejection (already submitted, etc.) is terminal — drop it.
        if (error && looksOffline(error)) { remaining.push(item); continue; }
        if (!error && (data as any)?.error && looksOffline((data as any))) { remaining.push(item); continue; }
        done++;
      } catch (e) {
        if (looksOffline(e)) remaining.push(item);
      }
    }
    await write(remaining);
  } finally {
    flushing = false;
  }
  return done;
}

/** Wire up automatic flushing on app start + when the browser comes online. */
export function initOfflineFlush() {
  flushQueue();
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("online", () => { flushQueue(); });
  }
}
