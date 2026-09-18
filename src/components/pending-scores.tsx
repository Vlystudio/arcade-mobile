import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { flushQueue, pendingSubmissions, type PendingSubmit } from "../../lib/offline-queue";
import { useAuth } from "../context/auth-context";

export function PendingScores() {
  const { user } = useAuth();
  const userId = user?.id;
  const currentUser = useRef(user?.id);
  currentUser.current = user?.id;
  const [pending, setPending] = useState<PendingSubmit[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setPending([]);
    setSyncing(false);
    setError(null);
    const refresh = async () => {
      if (!userId) return;
      try { const items = await pendingSubmissions(userId); if (active) { setPending(items); setError(null); } }
      catch { if (active) setError("Saved scores could not be read. Contact support before clearing app data."); }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [userId]);
  if (!user || (!pending.length && !error)) return null;
  return <View style={{ padding: 12, backgroundColor: "#2b220d" }}>
    <Text style={{ color: "#fff" }}>{error ?? `${pending.length} saved game${pending.length === 1 ? "" : "s"} waiting to sync.`}</Text>
    {!!pending[0]?.last_error && <Text style={{ color: "#fcd34d", marginTop: 4 }}>{pending[0].last_error}</Text>}
    <Pressable disabled={syncing} onPress={async () => {
      setSyncing(true);
      try { await flushQueue(user.id); const items = await pendingSubmissions(user.id); if (currentUser.current === user.id) { setPending(items); setError(null); } }
      catch { if (currentUser.current === user.id) setError("Sync failed. Your saved scores are still on this device."); }
      finally { if (currentUser.current === user.id) setSyncing(false); }
    }} accessibilityRole="button" style={{ paddingTop: 8 }}>
      <Text style={{ color: "#67e8f9" }}>{syncing ? "Syncing..." : "Retry saved scores"}</Text>
    </Pressable>
  </View>;
}
