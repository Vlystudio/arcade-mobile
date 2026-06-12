import { router } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { useAuth } from "../context/auth-context";

export function useRequireAuth() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      // Web visitors without an account land on the public marketing page;
      // the native app goes straight to sign-in.
      router.replace((Platform.OS === "web" ? "/welcome" : "/auth") as any);
    }
  }, [user, loading]);

  return { user, loading };
}
