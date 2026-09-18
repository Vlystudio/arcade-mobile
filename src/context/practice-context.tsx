import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { emptyPractice, parsePractice, type PracticeState } from "../../lib/practice";
import { useAuth } from "./auth-context";

type ContextValue = { state: PracticeState; ready: boolean; storage: "saving" | "saved" | "error"; save: (value: PracticeState) => Promise<void>; retry: () => Promise<void> };
const Context = createContext<ContextValue | null>(null);
export function PracticeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <PracticeStore key={user?.id ?? "guest"} scope={user?.id ?? "guest"}>{children}</PracticeStore>;
}
function PracticeStore({ scope, children }: { scope: string; children: React.ReactNode }) {
  const [state, setState] = useState(emptyPractice);
  const [ready, setReady] = useState(false);
  const [storage, setStorage] = useState<ContextValue["storage"]>("saved");
  const current = useRef(state), revision = useRef(0), writes = useRef(Promise.resolve()), hydrated = useRef(false);
  const key = `@arcade:practice:v1:${scope}`;
  const save = useCallback((value: PracticeState) => {
    if (!hydrated.current) return Promise.reject(new Error("Read device history before saving"));
    current.current = value; setState(value); setStorage("saving");
    const version = ++revision.current;
    const write = writes.current.catch(() => {}).then(() => AsyncStorage.setItem(key, JSON.stringify(value)));
    writes.current = write;
    void write.then(() => { if (version === revision.current) setStorage("saved"); }, () => { if (version === revision.current) setStorage("error"); });
    return write;
  }, [key]);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(key).then(raw => { if (alive) { const next = parsePractice(raw); hydrated.current = true; current.current = next; setState(next); } })
      .catch(() => { if (alive) setStorage("error"); }).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [key]);
  const retry = useCallback(async () => {
    if (hydrated.current) return save(current.current);
    setStorage("saving");
    try {
      const next = parsePractice(await AsyncStorage.getItem(key));
      hydrated.current = true; current.current = next; setState(next); setStorage("saved");
    } catch (error) { setStorage("error"); throw error; }
  }, [key, save]);
  return <Context.Provider value={{ state, ready, storage, save, retry }}>{children}</Context.Provider>;
}
export function usePractice() {
  const value = useContext(Context);
  if (!value) throw new Error("PracticeProvider missing");
  return value;
}
