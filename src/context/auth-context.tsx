import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { supabase } from "../../lib/supabase";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  signOut: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionRef = useRef<Session | null>(null);

  // Clear local state immediately so useRequireAuth redirects right away,
  // then invalidate the server session in the background.
  const signOut = useCallback(() => {
    setUser(null);
    setSession(null);
    sessionRef.current = null;
    supabase.auth.signOut().catch(() => {});
  }, []);

  // Verify the account still exists on the server. If deleted, sign out.
  const verifySession = useCallback(async () => {
    if (!sessionRef.current) return;
    const { error } = await supabase.auth.getUser();
    if (error) {
      setUser(null);
      setSession(null);
      sessionRef.current = null;
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      sessionRef.current = session;
      setLoading(false);
    });

    // Only sync state — navigation is handled by useRequireAuth in each screen.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      sessionRef.current = session;
    });

    // Check every 60 seconds while app is running
    const interval = setInterval(verifySession, 60_000);

    // Check immediately when app returns to foreground
    const handleAppState = (next: AppStateStatus) => {
      if (next === "active") verifySession();
    };
    const appStateSub = AppState.addEventListener("change", handleAppState);

    return () => {
      subscription.unsubscribe();
      clearInterval(interval);
      appStateSub.remove();
    };
  }, [verifySession]);

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
