import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Head from "expo-router/head";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAdmin } from "../context/admin-context";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";
import { showToast } from "../components/toast";

type VenueEvent = {
  id: string;
  title: string;
  description: string | null;
  event_type: string;
  starts_at: string;
  going: number;
  iAmGoing: boolean;
};

const TYPE_ICONS: Record<string, string> = {
  league: "bowling-ball-outline",
  karaoke: "mic-outline",
  trivia: "help-circle-outline",
  tournament: "trophy-outline",
  event: "sparkles-outline",
};

export default function EventsScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const { isAdmin } = useAdmin();
  const [events, setEvents] = useState<VenueEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rsvping, setRsvping] = useState<string | null>(null);

  // Admin create
  const [createVisible, setCreateVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dateText, setDateText] = useState("");
  const [timeText, setTimeText] = useState("19:00");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    if (!user) return;
    const [eventsRes, rsvpsRes] = await Promise.all([
      supabase
        .from("venue_events")
        .select("id, title, description, event_type, starts_at, event_rsvps(count)")
        .gte("starts_at", new Date(Date.now() - 6 * 3600_000).toISOString())
        .order("starts_at", { ascending: true })
        .limit(30),
      supabase.from("event_rsvps").select("event_id").eq("user_id", user.id),
    ]);
    const myRsvps = new Set((rsvpsRes.data ?? []).map((r: any) => r.event_id));
    setEvents((eventsRes.data ?? []).map((e: any) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      event_type: e.event_type,
      starts_at: e.starts_at,
      going: e.event_rsvps?.[0]?.count ?? 0,
      iAmGoing: myRsvps.has(e.id),
    })));
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { if (user) load(); }, [user]);

  async function toggleRsvp(ev: VenueEvent) {
    if (!user || rsvping) return;
    setRsvping(ev.id);
    if (ev.iAmGoing) {
      await supabase.from("event_rsvps").delete().eq("event_id", ev.id).eq("user_id", user.id);
    } else {
      await supabase.from("event_rsvps").insert({ event_id: ev.id, user_id: user.id });
    }
    setEvents((prev) => prev.map((e) =>
      e.id === ev.id ? { ...e, iAmGoing: !ev.iAmGoing, going: e.going + (ev.iAmGoing ? -1 : 1) } : e
    ));
    setRsvping(null);
  }

  async function handleCreate() {
    setCreateError(null);
    const t = title.trim();
    if (t.length < 2) { setCreateError("Title is required."); return; }
    const dt = new Date(`${dateText.trim()}T${timeText.trim() || "19:00"}:00`);
    if (isNaN(dt.getTime())) {
      setCreateError("Date must be YYYY-MM-DD and time HH:MM (24h).");
      return;
    }
    setCreating(true);
    const { error } = await supabase.from("venue_events").insert({
      title: t,
      description: description.trim() || null,
      event_type: "event",
      starts_at: dt.toISOString(),
      created_by: user!.id,
    });
    setCreating(false);
    if (error) { setCreateError(error.message); return; }
    setCreateVisible(false);
    setTitle(""); setDescription(""); setDateText("");
    showToast("Event published");
    load();
  }

  async function handleDelete(ev: VenueEvent) {
    await supabase.from("venue_events").delete().eq("id", ev.id);
    setEvents((prev) => prev.filter((e) => e.id !== ev.id));
    showToast("Event removed", "info");
  }

  if (authLoading || loading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Head><title>Events · ArcadeTracker</title></Head>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/")}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>What's On</Text>
          <Text style={s.headerSub}>Events at the bar</Text>
        </View>
        {isAdmin && (
          <Pressable style={s.addBtn} onPress={() => setCreateVisible(true)}>
            <Ionicons name="add" size={18} color="#000" />
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#06b6d4" />}
      >
        {events.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="calendar-outline" size={42} color="#333" />
            <Text style={s.emptyTitle}>Nothing scheduled yet</Text>
            <Text style={s.emptySub}>Upcoming karaoke nights, tournaments, and events will appear here.</Text>
          </View>
        ) : (
          events.map((ev) => {
            const d = new Date(ev.starts_at);
            return (
              <View key={ev.id} style={s.eventCard}>
                <View style={s.dateBox}>
                  <Text style={s.dateMonth}>{d.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</Text>
                  <Text style={s.dateDay}>{d.getDate()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name={(TYPE_ICONS[ev.event_type] ?? "sparkles-outline") as any} size={13} color="#06b6d4" />
                    <Text style={s.eventTitle} numberOfLines={1}>{ev.title}</Text>
                  </View>
                  <Text style={s.eventTime}>
                    {d.toLocaleDateString("en-US", { weekday: "long" })} · {d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </Text>
                  {ev.description ? <Text style={s.eventDesc} numberOfLines={2}>{ev.description}</Text> : null}
                  <Text style={s.goingText}>{ev.going} going</Text>
                </View>
                <View style={{ gap: 6, alignItems: "flex-end" }}>
                  <Pressable
                    style={[s.goingBtn, ev.iAmGoing && s.goingBtnActive]}
                    onPress={() => toggleRsvp(ev)}
                    disabled={rsvping === ev.id}
                  >
                    {rsvping === ev.id
                      ? <ActivityIndicator size="small" color={ev.iAmGoing ? "#000" : "#06b6d4"} />
                      : <Text style={[s.goingBtnText, ev.iAmGoing && s.goingBtnTextActive]}>
                          {ev.iAmGoing ? "Going ✓" : "I'm going"}
                        </Text>}
                  </Pressable>
                  {isAdmin && (
                    <Pressable onPress={() => handleDelete(ev)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={15} color="#553333" />
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Admin create event */}
      <Modal visible={createVisible} transparent animationType="slide" onRequestClose={() => setCreateVisible(false)}>
        <View style={s.modalBg}>
          <Pressable style={s.modalDismiss} onPress={() => setCreateVisible(false)} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>New Event</Text>
            <TextInput style={s.input} placeholder="Event title" placeholderTextColor="#555" value={title} onChangeText={setTitle} maxLength={80} />
            <TextInput style={[s.input, { minHeight: 60 }]} placeholder="Description (optional)" placeholderTextColor="#555" value={description} onChangeText={setDescription} multiline maxLength={500} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput style={[s.input, { flex: 1.4 }]} placeholder="Date (YYYY-MM-DD)" placeholderTextColor="#555" value={dateText} onChangeText={setDateText} autoCapitalize="none" />
              <TextInput style={[s.input, { flex: 1 }]} placeholder="Time (19:00)" placeholderTextColor="#555" value={timeText} onChangeText={setTimeText} autoCapitalize="none" />
            </View>
            {createError && <Text style={s.createError}>{createError}</Text>}
            <Pressable style={[s.publishBtn, creating && { opacity: 0.5 }]} onPress={handleCreate} disabled={creating}>
              {creating ? <ActivityIndicator size="small" color="#000" /> : <Text style={s.publishText}>Publish Event</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
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
  headerSub: { color: "#777", fontSize: 12, marginTop: 1 },
  addBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 18, paddingTop: 16 },

  eventCard: {
    flexDirection: "row", gap: 13, alignItems: "flex-start",
    backgroundColor: "#0d0d0d", borderRadius: 18, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: "#1a1a1a",
  },
  dateBox: {
    width: 50, borderRadius: 12, paddingVertical: 8, alignItems: "center",
    backgroundColor: "rgba(6,182,212,0.07)", borderWidth: 1, borderColor: "rgba(6,182,212,0.2)",
  },
  dateMonth: { color: "#06b6d4", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  dateDay: { color: "#fff", fontSize: 20, fontWeight: "900" },
  eventTitle: { color: "#fff", fontSize: 15, fontWeight: "800", flexShrink: 1 },
  eventTime: { color: "#8a8a8a", fontSize: 12.5, marginTop: 2 },
  eventDesc: { color: "#777", fontSize: 12.5, lineHeight: 17, marginTop: 4 },
  goingText: { color: "#06b6d4", fontSize: 11.5, fontWeight: "700", marginTop: 5 },
  goingBtn: {
    backgroundColor: "rgba(6,182,212,0.08)", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, minWidth: 86, alignItems: "center",
    borderWidth: 1, borderColor: "rgba(6,182,212,0.25)",
  },
  goingBtnActive: { backgroundColor: "#06b6d4", borderColor: "#06b6d4" },
  goingBtnText: { color: "#06b6d4", fontSize: 12.5, fontWeight: "800" },
  goingBtnTextActive: { color: "#000" },

  empty: { alignItems: "center", gap: 10, paddingVertical: 72, paddingHorizontal: 32 },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  emptySub: { color: "#8a8a8a", fontSize: 13.5, textAlign: "center", lineHeight: 19 },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  modalSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 22, paddingBottom: 36, borderTopWidth: 1, borderColor: "#1e1e1e",
    width: "100%", maxWidth: 560, alignSelf: "center", gap: 10,
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center" },
  modalTitle: { color: "#fff", fontSize: 18, fontWeight: "900", textAlign: "center", marginBottom: 4 },
  input: {
    backgroundColor: "#0a0a0a", borderRadius: 12, borderWidth: 1, borderColor: "#222",
    color: "#fff", fontSize: 14.5, padding: 13,
  },
  createError: { color: "#ef4444", fontSize: 13 },
  publishBtn: { backgroundColor: "#06b6d4", borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  publishText: { color: "#000", fontWeight: "900", fontSize: 15 },
});
