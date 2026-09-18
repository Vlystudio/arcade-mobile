import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { supabase } from "../../lib/supabase";
import { GameDraft, parseGameDraft } from "../../lib/experience";
import { useAuth } from "./auth-context";
import { pendingSubmissions } from "../../lib/offline-queue";
import { showToast } from "../components/toast";

type ActiveGame = { draft: GameDraft | null; ready: boolean; storage: "saving" | "saved" | "error"; save: (draft: GameDraft) => Promise<void>; clear: (sessionId: string) => Promise<void> };
const Context = createContext<ActiveGame | null>(null);
export function ActiveGameProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <GameState key={user?.id ?? "guest"} userId={user?.id ?? ""}>{children}</GameState>;
}
function GameState({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [draft, setDraft] = useState<GameDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [storage, setStorage] = useState<ActiveGame["storage"]>("saved");
  const revision = useRef(0);
  const current = useRef<GameDraft | null>(null);
  const writes = useRef(Promise.resolve());
  const storageKey = `@arcade:active-game:v1:${userId}`;
  const save = useCallback((next: GameDraft) => {
    if (next.userId !== userId) return Promise.reject(new Error("Wrong player"));
    current.current = next;
    setDraft(next);
    setStorage("saving");
    const version = ++revision.current;
    const write = writes.current.catch(() => {}).then(() => AsyncStorage.setItem(storageKey, JSON.stringify(next)));
    writes.current = write;
    void write.then(() => { if (revision.current === version) setStorage("saved"); }, () => { if (revision.current === version) setStorage("error"); });
    return write;
  }, [storageKey, userId]);
  const clear = useCallback((sessionId: string) => {
    if (current.current?.sessionId !== sessionId) return Promise.resolve();
    current.current = null;
    setDraft(null);
    ++revision.current;
    setStorage("saved");
    const write = writes.current.catch(() => {}).then(() => AsyncStorage.removeItem(storageKey));
    writes.current = write;
    return write;
  }, [storageKey]);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(storageKey).then(raw => {
      if (!alive) return;
      const saved = parseGameDraft(raw, userId);
      current.current = saved;
      setDraft(saved);
    }).catch(() => {}).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [storageKey, userId]);
  useEffect(() => {
    if (!ready || !userId) return;
    let alive = true;
    let checking = false;
    let warned = "";
    async function validate() {
      const id = current.current?.sessionId;
      if (!id || checking) return;
      checking = true;
      try {
        const { data, error } = await supabase.from("skeeball_sessions").select("status, last_activity_at, skeeball_ball_scores(id)").eq("id", id).maybeSingle();
        // Keep the local draft on network failure; only server confirmation invalidates it.
        if (!alive || error || current.current?.sessionId !== id) return;
        if (!data || data.status !== "active") { await clear(id); return; }
        if (data.skeeball_ball_scores?.length >= 9) return;
        const idle = Date.now() - new Date(data.last_activity_at).getTime();
        // A queued submission needs to finish syncing, not expire in the background.
        if ((await pendingSubmissions(userId)).some(item => item.session_id === id)) return;
        if (!alive || current.current?.sessionId !== id || !data.last_activity_at) return;
        if (idle >= 10 * 60_000) {
          // Compare the timestamp so another player's recent activity cannot be cancelled.
          const ended = await supabase.from("skeeball_sessions").update({ status: "abandoned" }).eq("id", id).eq("status", "active").eq("last_activity_at", data.last_activity_at).select("id");
          if (!ended.error && ended.data?.length) {
            await clear(id);
            showToast("Your inactive game ended and the lane was released.", "info");
          }
        } else if (idle >= 8 * 60_000 && warned !== id) {
          warned = id;
          showToast("Your lane is about to time out. Resume your game to keep playing.", "info");
        } else if (idle < 8 * 60_000) warned = "";
      } catch { /* Storage or network failures preserve the draft. */ }
      finally { checking = false; }
    }
    void validate();
    const timer = setInterval(() => { if (AppState.currentState === "active") void validate(); }, 30_000);
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void validate(); });
    return () => { alive = false; clearInterval(timer); subscription.remove(); };
  }, [clear, ready, userId]);
  return <Context.Provider value={{ draft, ready, storage, save, clear }}>{children}</Context.Provider>;
}
export function useActiveGame() {
  const value = useContext(Context);
  if (!value) throw new Error("ActiveGameProvider missing");
  return value;
}
