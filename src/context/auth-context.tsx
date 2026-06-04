import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { supabase } from "../../lib/supabase";

// How long a backgrounded session stays valid before auto-logout
const INACTIVE_TIMEOUT_MS  = 30 * 60 * 1000;  // 30 min — no "Remember Me"
const REMEMBER_ME_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — "Remember Me"

const BG_TIME_KEY   = "@arcade:backgroundAt";
const REMEMBER_KEY  = "@arcade:rememberMe";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => void;
  setRememberMe: (val: boolean) => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  signOut: () => {},
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

  const signOut = useCallback(() => {
    setUser(null);
    setSession(null);
    sessionRef.current = null;
    AsyncStorage.multiRemove([BG_TIME_KEY]).catch(() => {});
    supabase.auth.signOut().catch(() => {});
  }, []);

  // Verify the account still exists and check inactivity timeout.
  const verifySession = useCallback(async () => {
    if (!sessionRef.current) return;

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
        signOut();
        return;
      }
    }

    const { error } = await supabase.auth.getUser();
    if (error) {
      setUser(null);
      setSession(null);
      sessionRef.current = null;
    }
  }, [signOut]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      sessionRef.current = session;
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      sessionRef.current = session;
    });

    const interval = setInterval(verifySession, 60_000);

    const handleAppState = (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        // Record when we went to background
        AsyncStorage.setItem(BG_TIME_KEY, Date.now().toString()).catch(() => {});
      } else if (next === "active") {
        // Clear background timestamp and check inactivity
        verifySession().then(() => {
          AsyncStorage.removeItem(BG_TIME_KEY).catch(() => {});
        });
      }
    };

    const appStateSub = AppState.addEventListener("change", handleAppState);

    return () => {
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
