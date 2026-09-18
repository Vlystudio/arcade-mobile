import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Session, User } from "@supabase/supabase-js";
import { router } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { supabase } from "../../lib/supabase";
import { isInvalidSession } from "../../lib/auth-errors";
import { unregisterForPush } from "../lib/push";

// How long a backgrounded session stays valid before auto-logout
const INACTIVE_TIMEOUT_MS  = 30 * 60 * 1000;  // 30 min — no "Remember Me"
const REMEMBER_ME_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — "Remember Me"

const BG_TIME_KEY   = "@arcade:backgroundAt";
const REMEMBER_KEY  = "@arcade:rememberMe";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  setRememberMe: (val: boolean) => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
  setRememberMe: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionRef            = useRef<Session | null>(null);

  const setRememberMe = useCallback((val: boolean) => {
    AsyncStorage.setItem(REMEMBER_KEY, val ? "1" : "0").catch(() => {});
  }, []);

  const signOut = useCallback(async () => {
    await unregisterForPush().catch(console.warn);
    await supabase.auth.signOut({ scope: "local" });
    setUser(null);
    setSession(null);
    sessionRef.current = null;
    AsyncStorage.removeItem(BG_TIME_KEY).catch(() => {});
  }, []);

  // Verify the account still exists and check inactivity timeout.
  const verifySession = useCallback(async () => {
    const checkedSession = sessionRef.current;
    if (!checkedSession) return;
    try {

    // Check inactivity: how long was the app in the background?
    const [bgTimeStr, rememberStr] = await Promise.all([
      AsyncStorage.getItem(BG_TIME_KEY),
      AsyncStorage.getItem(REMEMBER_KEY),
    ]);

    if (bgTimeStr) {
      const bgTime  = parseInt(bgTimeStr, 10);
      const elapsed = Date.now() - bgTime;
      const timeout = rememberStr === "1" ? REMEMBER_ME_TIMEOUT_MS : INACTIVE_TIMEOUT_MS;

      if (elapsed > timeout) {
        if (sessionRef.current === checkedSession) await signOut();
        return;
      }
    }

    const { error } = await supabase.auth.getUser();
    if (isInvalidSession(error) && sessionRef.current === checkedSession) {
      await signOut();
    }
    } catch { /* A network/storage outage does not invalidate a session. */ }
  }, [signOut]);

  useEffect(() => {
    let active = true;
    let authChanged = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active || authChanged) return;
      setSession(session);
      setUser(session?.user ?? null);
      sessionRef.current = session;
      setLoading(false);
    }).catch(() => { if (active) setLoading(false); });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      authChanged = true;
      setSession(session);
      setUser(session?.user ?? null);
      sessionRef.current = session;
      setLoading(false);
      if (event === "PASSWORD_RECOVERY") {
        // Redirect to the reset-password screen regardless of where the link landed
        setTimeout(() => router.replace("/reset-password" as any), 0);
      }
    });

    const interval = setInterval(verifySession, 60_000);

    const handleAppState = (next: AppStateStatus) => {
      if (Platform.OS !== "web") {
        if (next === "active") supabase.auth.startAutoRefresh();
        else supabase.auth.stopAutoRefresh();
      }
      if (next === "background" || next === "inactive") {
        // Record when we went to background
        AsyncStorage.setItem(BG_TIME_KEY, Date.now().toString()).catch(() => {});
      } else if (next === "active") {
        // Clear background timestamp and check inactivity
        verifySession().finally(() => {
          AsyncStorage.removeItem(BG_TIME_KEY).catch(() => {});
        });
      }
    };

    const appStateSub = AppState.addEventListener("change", handleAppState);
    if (Platform.OS !== "web" && AppState.currentState === "active") supabase.auth.startAutoRefresh();

    return () => {
      active = false;
      if (Platform.OS !== "web") supabase.auth.stopAutoRefresh();
      subscription.unsubscribe();
      clearInterval(interval);
      appStateSub.remove();
    };
  }, [verifySession]);

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut, setRememberMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
