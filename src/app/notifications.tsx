import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Head from "expo-router/head";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRequireAuth } from "../hooks/use-require-auth";
import { fetchInbox, markInboxSeen, type InboxItem } from "../lib/inbox";

function relTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function NotificationsScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    if (!user) return;
    const inbox = await fetchInbox(user.id);
    setItems(inbox);
    setLoading(false);
    setRefreshing(false);
    markInboxSeen();
  }

  useEffect(() => { if (user) load(); }, [user]);

  if (authLoading || loading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Head><title>Notifications · ArcadeTracker</title></Head>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/")}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>Notifications</Text>
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#06b6d4" />}
      >
        {items.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="notifications-off-outline" size={42} color="#333" />
            <Text style={s.emptyTitle}>All caught up</Text>
            <Text style={s.emptySub}>Invites, join requests, round results, and announcements show up here.</Text>
          </View>
        ) : (
          items.map((item) => (
            <Pressable
              key={item.id}
              style={({ pressed }) => [s.row, pressed && item.route ? { opacity: 0.7 } : null]}
              onPress={() => item.route && router.push({ pathname: item.route.pathname as any, params: item.route.params })}
              disabled={!item.route}
            >
              <View style={[s.iconWrap, { backgroundColor: `${item.color}14`, borderColor: `${item.color}30` }]}>
                <Ionicons name={item.icon as any} size={17} color={item.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{item.title}</Text>
                {item.body ? <Text style={s.body} numberOfLines={2}>{item.body}</Text> : null}
              </View>
              <Text style={s.time}>{relTime(item.created_at)}</Text>
              {item.route && <Ionicons name="chevron-forward" size={14} color="#333" />}
            </Pressable>
          ))
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  content: { paddingHorizontal: 16, paddingTop: 10 },

  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#161616",
  },
  iconWrap: {
    width: 38, height: 38, borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  title: { color: "#fff", fontSize: 14, fontWeight: "700", lineHeight: 19 },
  body: { color: "#8a8a8a", fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  time: { color: "#555", fontSize: 11.5, fontWeight: "600" },

  empty: { alignItems: "center", gap: 10, paddingVertical: 80, paddingHorizontal: 32 },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  emptySub: { color: "#8a8a8a", fontSize: 13.5, textAlign: "center", lineHeight: 19 },
});
