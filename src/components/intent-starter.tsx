import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAuth } from "../context/auth-context";
import { PressableScale } from "./pressable-scale";

const OPTIONS = [
  { key: "play", title: "Playing tonight", detail: "Start a group game or play casually", route: "/start-game", icon: "game-controller-outline" },
  { key: "league", title: "Joining a league", detail: "Find a team and your next league night", route: "/teams", icon: "people-outline" },
  { key: "order", title: "Just ordering", detail: "Choose your venue and browse the menu", route: "/food", icon: "restaurant-outline" },
] as const;

export function IntentStarter({ always = false }: { always?: boolean }) {
  const { user } = useAuth();
  const userId = user?.id;
  const key = `@arcade:intent:v1:${user?.id ?? "guest"}`;
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setSaved(undefined);
    async function restore() {
      const value = await AsyncStorage.getItem(key);
      if (active) setSaved(value);
      if (userId) {
        const pending = await AsyncStorage.getItem("@arcade:pending-intent:v1");
        if (active && (pending === "/games" || pending === "/teams" || pending === "/practice" || pending === "/start-game")) {
          await AsyncStorage.setItem(key, pending === "/teams" ? "league" : "play");
          await AsyncStorage.removeItem("@arcade:pending-intent:v1");
          if (active) router.replace(pending);
        }
      }
    }
    void restore().catch(() => { if (active) setSaved(null); });
    return () => { active = false; };
  }, [key, userId]);
  if (!always && (saved === undefined || saved)) return null;
  async function choose(option: typeof OPTIONS[number]) {
    setSaved(option.key);
    await AsyncStorage.setItem(key, option.key).catch(() => {});
    // Practice and ordering are available before sign-in.
    if (!user && option.key === "league") {
      await AsyncStorage.setItem("@arcade:pending-intent:v1", option.route).catch(() => {});
      router.push("/auth");
    } else {
      await AsyncStorage.removeItem("@arcade:pending-intent:v1").catch(() => {});
      router.push(option.route);
    }
  }
  return <View style={s.card}>
    <Text style={s.title}>What brings you in?</Text>
    <Text style={s.sub}>Start with what you need. Your profile can wait.</Text>
    {OPTIONS.map(option => <PressableScale key={option.key} style={s.option} onPress={() => choose(option)}>
      <Ionicons name={option.icon} size={22} color="#67e8f9" />
      <View style={{ flex: 1 }}><Text style={s.label}>{option.title}</Text><Text style={s.sub}>{option.detail}</Text></View>
      <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
    </PressableScale>)}
    {!always && <PressableScale style={s.skip} onPress={() => { setSaved("later"); void AsyncStorage.setItem(key, "later").catch(() => {}); }}><Text style={s.sub}>I’ll explore first</Text></PressableScale>}
  </View>;
}
const s = StyleSheet.create({ card: { padding: 18, borderRadius: 18, backgroundColor: "#101416", borderWidth: 1, borderColor: "#25343a", gap: 8, marginBottom: 16 }, title: { color: "#fff", fontSize: 20, fontWeight: "800" }, sub: { color: "#aeb7c0", fontSize: 13, lineHeight: 19 }, option: { flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 12, minHeight: 64, borderTopWidth: 1, borderColor: "#283035" }, label: { color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 3 }, skip: { minHeight: 44, justifyContent: "center", alignItems: "center" } });
