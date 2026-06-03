import { router } from "expo-router";
import { useEffect } from "react";
import { useAuth } from "../context/auth-context";

export function useRequireAuth() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth" as any);
    }
  }, [user, loading]);

  return { user, loading };
}
