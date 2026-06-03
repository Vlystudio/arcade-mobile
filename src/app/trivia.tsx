import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomTabBar from "../components/bottom-tab-bar";
import { useAdmin } from "../context/admin-context";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";

type TriviaEvent = {
  id: string;
  title: string;
  description: string | null;
  signup_deadline: string;
  event_date: string | null;
  status: "signup" | "active" | "closed";
  created_at: string;
};

type TriviaTeam = {
  id: string;
  event_id: string;
  team_name: string;
  captain_user_id: string;
  captain_username: string;
  member_count: number;
  is_mine: boolean;
};

export default function TriviaScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const { isAdmin } = useAdmin();
  const [event, setEvent] = useState<TriviaEvent | null>(null);
  const [teams, setTeams] = useState<TriviaTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [createModal, setCreateModal] = useState(false);
  const [teamNameInput, setTeamNameInput] = useState("");
  const [creating, setCreating] = useState(false);

  const [joinTarget, setJoinTarget] = useState<TriviaTeam | null>(null);
  const [joining, setJoining] = useState(false);

  const [adminModal, setAdminModal] = useState(false);
  const [eventTitle, setEventTitle] = useState("");
  const [eventHours, setEventHours] = useState("2");
  const [openingEvent, setOpeningEvent] = useState(false);

  const [closeTarget, setCloseTarget] = useState<TriviaEvent | null>(null);
  const [closingEvent, setClosingEvent] = useState(false);

  const myTeam = teams.find((t) => t.is_mine) ?? null;
  const signupOpen = !!event && event.status === "signup" && new Date(event.signup_deadline) > new Date();

  useEffect(() => {
    if (user) load();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [user]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("trivia_events")
      .select("*")
      .in("status", ["signup", "active"])
      .order("created_at", { ascending: false })
      .limit(1);

    const ev: TriviaEvent | null = data?.[0] ?? null;
    setEvent(ev);
    if (ev) {
      await loadTeams(ev.id);
      startCountdown(ev.signup_deadline);
    }
    setLoading(false);
  }

  async function loadTeams(eventId: string) {
    const { data: teamsData } = await supabase
      .from("trivia_teams")
      .select("id, team_name, captain_user_id, created_at")
      .eq("event_id", eventId)
      .order("created_at");

    const teamIds = (teamsData ?? []).map((t: any) => t.id);
    let membersData: any[] = [];
    if (teamIds.length) {
      const { data } = await supabase
        .from("trivia_team_members")
        .select("trivia_team_id, user_id")
        .in("trivia_team_id", teamIds);
      membersData = data ?? [];
    }

    const captainIds = [...new Set((teamsData ?? []).map((t: any) => t.captain_user_id))] as string[];
    let captainMap: Record<string, string> = {};
    if (captainIds.length) {
      const { data: profiles } = await supabase
        .from("profiles").select("id, username").in("id", captainIds);
      for (const p of (profiles ?? [])) captainMap[(p as any).id] = (p as any).username;
    }

    const memberCountMap: Record<string, number> = {};
    const userTeamIds = new Set<string>();
    for (const m of membersData) {
      memberCountMap[m.trivia_team_id] = (memberCountMap[m.trivia_team_id] ?? 0) + 1;
      if (m.user_id === user!.id) userTeamIds.add(m.trivia_team_id);
    }

    setTeams((teamsData ?? []).map((t: any) => ({
      id: t.id,
      event_id: eventId,
      team_name: t.team_name,
      captain_user_id: t.captain_user_id,
      captain_username: captainMap[t.captain_user_id] ?? "Unknown",
      member_count: memberCountMap[t.id] ?? 1,
      is_mine: userTeamIds.has(t.id) || t.captain_user_id === user!.id,
    })));
  }

  function startCountdown(deadline: string) {
    if (timerRef.current) clearInterval(timerRef.current);
    function tick() {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) {
        setCountdown("Signup closed");
        clearInterval(timerRef.current!);
        setEvent((prev) => prev ? { ...prev, status: "active" } : prev);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`);
    }
    tick();
    timerRef.current = setInterval(tick, 1000);
  }

  async function handleCreateTeam() {
    if (!user || !event || !teamNameInput.trim()) return;
    setCreating(true);
    const { data: teamData, error } = await supabase
      .from("trivia_teams")
      .insert({ event_id: event.id, team_name: teamNameInput.trim(), captain_user_id: user.id })
      .select("id").single();
    if (error || !teamData) {
      Alert.alert("Error", error?.message ?? "Could not create team");
      setCreating(false);
      return;
    }
    await supabase.from("trivia_team_members").insert({ trivia_team_id: teamData.id, user_id: user.id });
    setCreating(false);
    setCreateModal(false);
    setTeamNameInput("");
    await loadTeams(event.id);
  }

  async function handleJoinTeam() {
    if (!user || !event || !joinTarget) return;
    setJoining(true);
    const { error } = await supabase
      .from("trivia_team_members")
      .insert({ trivia_team_id: joinTarget.id, user_id: user.id });
    if (error) Alert.alert("Error", error.message);
    setJoining(false);
    setJoinTarget(null);
    await loadTeams(event.id);
  }

  async function handleLeaveTeam() {
    if (!user || !event || !myTeam) return;
    if (myTeam.captain_user_id === user.id) {
      Alert.alert("Disband Team", "As captain, leaving will disband this trivia team. Continue?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disband", style: "destructive", onPress: async () => {
            await supabase.from("trivia_team_members").delete().eq("trivia_team_id", myTeam.id);
            await supabase.from("trivia_teams").delete().eq("id", myTeam.id);
            await loadTeams(event!.id);
          },
        },
      ]);
      return;
    }
    await supabase.from("trivia_team_members").delete()
      .eq("trivia_team_id", myTeam.id).eq("user_id", user.id);
    await loadTeams(event.id);
  }

  async function handleOpenEvent() {
    if (!user || !eventTitle.trim() || !eventHours.trim()) return;
    const hours = parseFloat(eventHours);
    if (isNaN(hours) || hours <= 0) {
      Alert.alert("Invalid", "Enter a valid number of hours.");
      return;
    }
    setOpeningEvent(true);
    const deadline = new Date(Date.now() + hours * 3600000).toISOString();
    await supabase.from("trivia_events").insert({
      title: eventTitle.trim(),
      signup_deadline: deadline,
      status: "signup",
      created_by: user.id,
    });
    setOpeningEvent(false);
    setAdminModal(false);
    setEventTitle("");
    setEventHours("2");
    await load();
  }

  async function handleCloseEvent() {
    if (!closeTarget) return;
    setClosingEvent(true);
    await supabase.from("trivia_events").update({ status: "closed" }).eq("id", closeTarget.id);
    if (timerRef.current) clearInterval(timerRef.current);
    setClosingEvent(false);
    setCloseTarget(null);
    setEvent(null);
    setTeams([]);
    setCountdown("");
  }

  if (authLoading || loading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#f59e0b" /></View>;
  }

  return (
    <View style={s.root}>
      <SafeAreaView style={s.safe} edges={["top"]}>
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* Header */}
          <View style={s.pageHeader}>
            <View style={s.headerLeft}>
              <View style={s.headerIconWrap}>
                <Ionicons name="help-circle" size={26} color="#f59e0b" />
              </View>
              <View>
                <Text style={s.pageTitle}>Trivia Night</Text>
                <Text style={s.pageSub}>Teams · Min. 3 players required</Text>
              </View>
            </View>
            {isAdmin && !event && (
              <Pressable style={s.adminOpenBtn} onPress={() => setAdminModal(true)}>
                <Ionicons name="add" size={16} color="#000" />
                <Text style={s.adminOpenBtnText}>Open Event</Text>
              </Pressable>
            )}
            {isAdmin && event && (
              <Pressable style={s.adminCloseBtn} onPress={() => setCloseTarget(event)}>
                <Ionicons name="stop-circle-outline" size={16} color="#ef4444" />
                <Text style={s.adminCloseBtnText}>Close</Text>
              </Pressable>
            )}
          </View>

          {/* No active event */}
          {!event && (
            <View style={s.emptyWrap}>
              <View style={s.emptyIconWrap}>
                <Ionicons name="help-buoy-outline" size={48} color="#f59e0b" />
              </View>
              <Text style={s.emptyTitle}>No Trivia Event</Text>
              <Text style={s.emptySub}>
                {isAdmin
                  ? 'Tap "Open Event" to start a trivia signup window for tonight.'
                  : "The venue will post the next trivia night here. Check back soon!"}
              </Text>
            </View>
          )}

          {/* Active event */}
          {event && (
            <>
              {/* Event card with countdown */}
              <View style={s.eventCard}>
                <Text style={s.eventTitle}>{event.title}</Text>

                <View style={s.eventMeta}>
                  <View style={[s.statusBadge, { backgroundColor: signupOpen ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)" }]}>
                    <View style={[s.statusDot, { backgroundColor: signupOpen ? "#22c55e" : "#f59e0b" }]} />
                    <Text style={[s.statusText, { color: signupOpen ? "#22c55e" : "#f59e0b" }]}>
                      {signupOpen ? "Signup Open" : "Signup Closed"}
                    </Text>
                  </View>
                  <View style={s.teamCountChip}>
                    <Ionicons name="people-outline" size={13} color="#888" />
                    <Text style={s.teamCountText}>
                      {teams.length} {teams.length === 1 ? "team" : "teams"}
                    </Text>
                  </View>
                </View>

                {signupOpen && countdown ? (
                  <View style={s.countdownBox}>
                    <Ionicons name="timer-outline" size={20} color="#f59e0b" />
                    <View>
                      <Text style={s.countdownTime}>{countdown}</Text>
                      <Text style={s.countdownLabel}>until signup closes</Text>
                    </View>
                  </View>
                ) : null}
              </View>

              {/* My registered team */}
              {myTeam && (
                <View style={s.myTeamCard}>
                  <View style={s.myTeamTop}>
                    <View style={s.myTeamLeft}>
                      <Ionicons name="people" size={18} color="#f59e0b" />
                      <Text style={s.myTeamLabel}>YOUR TEAM</Text>
                    </View>
                    {signupOpen && (
                      <Pressable onPress={handleLeaveTeam}>
                        <Text style={s.leaveBtnText}>Leave</Text>
                      </Pressable>
                    )}
                  </View>
                  <Text style={s.myTeamName}>{myTeam.team_name}</Text>
                  <View style={[
                    s.memberCountRow,
                    myTeam.member_count < 3 && s.memberCountRowWarn,
                  ]}>
                    <Ionicons
                      name={myTeam.member_count < 3 ? "warning-outline" : "checkmark-circle-outline"}
                      size={14}
                      color={myTeam.member_count < 3 ? "#f97316" : "#22c55e"}
                    />
                    <Text style={[
                      s.memberCountText,
                      myTeam.member_count < 3 && s.memberCountTextWarn,
                    ]}>
                      {myTeam.member_count} {myTeam.member_count === 1 ? "member" : "members"}
                      {myTeam.member_count < 3 ? " — need at least 3 to compete" : " — ready to compete!"}
                    </Text>
                  </View>
                  {myTeam.member_count < 3 && (
                    <Text style={s.memberHint}>
                      Have teammates find this team in the list below and tap Join.
                    </Text>
                  )}
                </View>
              )}

              {/* Register button for users not yet in a team */}
              {!myTeam && signupOpen && (
                <Pressable style={s.registerBtn} onPress={() => setCreateModal(true)}>
                  <Ionicons name="add-circle" size={20} color="#000" />
                  <Text style={s.registerBtnText}>Register Your Team</Text>
                </Pressable>
              )}

              {/* All teams list */}
              {teams.length > 0 && (
                <>
                  <Text style={s.sectionLabel}>REGISTERED TEAMS ({teams.length})</Text>
                  {teams.map((team) => (
                    <View key={team.id} style={[s.teamCard, team.is_mine && s.teamCardMine]}>
                      <View style={s.teamAvatar}>
                        <Text style={s.teamAvatarText}>{team.team_name.slice(0, 2).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.teamName}>{team.team_name}</Text>
                        <Text style={s.teamMeta}>
                          {team.captain_username} · {team.member_count} {team.member_count === 1 ? "member" : "members"}
                        </Text>
                      </View>
                      {team.member_count < 3 && (
                        <Ionicons name="warning" size={14} color="#f97316" style={{ marginRight: 4 }} />
                      )}
                      {!myTeam && signupOpen && (
                        <Pressable style={s.joinBtn} onPress={() => setJoinTarget(team)}>
                          <Text style={s.joinBtnText}>Join</Text>
                        </Pressable>
                      )}
                      {team.is_mine && (
                        <View style={s.mineTag}>
                          <Text style={s.mineTagText}>You</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </>
              )}

              {/* Empty teams state during open signup */}
              {teams.length === 0 && signupOpen && (
                <View style={s.noTeamsHint}>
                  <Text style={s.noTeamsText}>No teams yet — be the first to register!</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      <BottomTabBar />

      {/* Create team modal */}
      <Modal visible={createModal} transparent animationType="slide" onRequestClose={() => setCreateModal(false)}>
        <View style={s.modalBg}>
          <Pressable style={s.modalDismiss} onPress={() => setCreateModal(false)} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Register Your Team</Text>
            <Text style={s.modalSub}>You'll be the captain. Teammates can join from the list.</Text>
            <Text style={s.inputLabel}>Team Name</Text>
            <TextInput
              style={s.input}
              placeholder="e.g. Quiz Khalifa"
              placeholderTextColor="#333"
              value={teamNameInput}
              onChangeText={setTeamNameInput}
              maxLength={40}
              autoFocus
            />
            <Pressable
              style={[s.submitBtn, (!teamNameInput.trim() || creating) && { opacity: 0.4 }]}
              onPress={handleCreateTeam}
              disabled={!teamNameInput.trim() || creating}
            >
              {creating
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={s.submitBtnText}>Create Team</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Join team confirm */}
      <Modal visible={!!joinTarget} transparent animationType="fade" onRequestClose={() => setJoinTarget(null)}>
        <View style={s.confirmBg}>
          <Pressable style={s.confirmDismiss} onPress={() => setJoinTarget(null)} />
          <View style={s.confirmSheet}>
            <View style={s.confirmIconWrap}>
              <Ionicons name="people" size={36} color="#f59e0b" />
            </View>
            <Text style={s.confirmTitle}>Join "{joinTarget?.team_name}"?</Text>
            <Text style={s.confirmBody}>You'll be added as a member of this trivia team.</Text>
            <View style={s.confirmBtns}>
              <Pressable style={s.confirmCancel} onPress={() => setJoinTarget(null)}>
                <Text style={s.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.confirmAction, joining && { opacity: 0.5 }]}
                onPress={handleJoinTeam}
                disabled={joining}
              >
                {joining
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Text style={s.confirmActionText}>Join Team</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Admin open event modal */}
      <Modal visible={adminModal} transparent animationType="slide" onRequestClose={() => setAdminModal(false)}>
        <View style={s.modalBg}>
          <Pressable style={s.modalDismiss} onPress={() => setAdminModal(false)} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Open Trivia Signup</Text>
            <Text style={s.modalSub}>Teams can register until the signup window closes.</Text>
            <Text style={s.inputLabel}>Event Name</Text>
            <TextInput
              style={s.input}
              placeholder="e.g. Wednesday Trivia Night"
              placeholderTextColor="#333"
              value={eventTitle}
              onChangeText={setEventTitle}
              maxLength={60}
            />
            <Text style={s.inputLabel}>Signup Window (hours)</Text>
            <TextInput
              style={s.input}
              placeholder="2"
              placeholderTextColor="#333"
              value={eventHours}
              onChangeText={setEventHours}
              keyboardType="decimal-pad"
              maxLength={4}
            />
            <Pressable
              style={[s.submitBtn, (!eventTitle.trim() || !eventHours.trim() || openingEvent) && { opacity: 0.4 }]}
              onPress={handleOpenEvent}
              disabled={!eventTitle.trim() || !eventHours.trim() || openingEvent}
            >
              {openingEvent
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={s.submitBtnText}>Open Signup</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Admin close event confirm */}
      <Modal visible={!!closeTarget} transparent animationType="fade" onRequestClose={() => setCloseTarget(null)}>
        <View style={s.confirmBg}>
          <Pressable style={s.confirmDismiss} onPress={() => setCloseTarget(null)} />
          <View style={s.confirmSheet}>
            <View style={[s.confirmIconWrap, { borderColor: "rgba(239,68,68,0.25)", backgroundColor: "rgba(239,68,68,0.08)" }]}>
              <Ionicons name="stop-circle-outline" size={36} color="#ef4444" />
            </View>
            <Text style={s.confirmTitle}>Close Trivia Event?</Text>
            <Text style={s.confirmBody}>
              This ends the signup window for "{closeTarget?.title}". Registered teams will be preserved.
            </Text>
            <View style={s.confirmBtns}>
              <Pressable style={s.confirmCancel} onPress={() => setCloseTarget(null)}>
                <Text style={s.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.confirmClose, closingEvent && { opacity: 0.5 }]}
                onPress={handleCloseEvent}
                disabled={closingEvent}
              >
                {closingEvent
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.confirmCloseText}>Close Event</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#0a0a0a" },
  safe:   { flex: 1 },
  loader: { flex: 1, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 32 },

  pageHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 22,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerIconWrap: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: "rgba(245,158,11,0.1)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
  },
  pageTitle: { color: "#fff", fontSize: 26, fontWeight: "900", letterSpacing: -0.5 },
  pageSub:   { color: "#444", fontSize: 12, marginTop: 1 },

  adminOpenBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#f59e0b", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9,
  },
  adminOpenBtnText: { color: "#000", fontWeight: "800", fontSize: 13 },
  adminCloseBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.08)",
  },
  adminCloseBtnText: { color: "#ef4444", fontWeight: "700", fontSize: 13 },

  emptyWrap: { alignItems: "center", paddingTop: 80, gap: 14 },
  emptyIconWrap: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: "rgba(245,158,11,0.08)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(245,158,11,0.18)",
  },
  emptyTitle: { color: "#fff", fontSize: 20, fontWeight: "900" },
  emptySub:   { color: "#444", fontSize: 14, textAlign: "center", maxWidth: 280, lineHeight: 20 },

  eventCard: {
    backgroundColor: "#111", borderRadius: 20,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
    padding: 20, marginBottom: 14,
  },
  eventTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 12 },
  eventMeta:  { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  statusDot:  { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: "700" },
  teamCountChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    backgroundColor: "#1a1a1a",
  },
  teamCountText: { color: "#888", fontSize: 12, fontWeight: "600" },
  countdownBox: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(245,158,11,0.06)", borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: "rgba(245,158,11,0.15)",
  },
  countdownTime:  { color: "#f59e0b", fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  countdownLabel: { color: "#666", fontSize: 12, marginTop: 1 },

  myTeamCard: {
    backgroundColor: "rgba(245,158,11,0.06)", borderRadius: 20,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.18)",
    padding: 18, marginBottom: 14,
  },
  myTeamTop:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  myTeamLeft:  { flexDirection: "row", alignItems: "center", gap: 8 },
  myTeamLabel: { color: "#f59e0b", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  myTeamName:  { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 10 },
  leaveBtnText:{ color: "#ef4444", fontSize: 13, fontWeight: "700" },
  memberCountRow: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "rgba(34,197,94,0.08)", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  memberCountRowWarn: { backgroundColor: "rgba(249,115,22,0.08)" },
  memberCountText:     { color: "#22c55e", fontSize: 13, fontWeight: "600", flex: 1 },
  memberCountTextWarn: { color: "#f97316" },
  memberHint: { color: "#555", fontSize: 12, marginTop: 8, lineHeight: 17 },

  registerBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#f59e0b", borderRadius: 18,
    paddingVertical: 16, marginBottom: 20,
  },
  registerBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },

  sectionLabel: {
    color: "#333", fontSize: 11, fontWeight: "800", letterSpacing: 1.2,
    marginTop: 4, marginBottom: 12,
  },
  teamCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "#111", borderRadius: 18,
    borderWidth: 1, borderColor: "#1e1e1e",
    padding: 14, marginBottom: 8,
  },
  teamCardMine: { borderColor: "rgba(245,158,11,0.3)", backgroundColor: "rgba(245,158,11,0.04)" },
  teamAvatar: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: "rgba(245,158,11,0.1)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
  },
  teamAvatarText: { color: "#f59e0b", fontSize: 13, fontWeight: "900" },
  teamName: { color: "#fff", fontSize: 15, fontWeight: "800" },
  teamMeta: { color: "#555", fontSize: 12, marginTop: 2 },
  joinBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: "rgba(245,158,11,0.12)",
    borderWidth: 1, borderColor: "rgba(245,158,11,0.3)",
  },
  joinBtnText: { color: "#f59e0b", fontWeight: "700", fontSize: 13 },
  mineTag: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    backgroundColor: "rgba(245,158,11,0.15)",
  },
  mineTagText: { color: "#f59e0b", fontWeight: "800", fontSize: 11 },

  noTeamsHint: {
    backgroundColor: "#111", borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: "#1e1e1e", alignItems: "center",
  },
  noTeamsText: { color: "#333", fontSize: 14 },

  // Modal styles
  modalBg:      { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  modalSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 40,
    borderWidth: 1, borderColor: "#1e1e1e",
  },
  modalHandle: { width: 40, height: 4, backgroundColor: "#222", borderRadius: 2, alignSelf: "center", marginBottom: 20 },
  modalTitle:  { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  modalSub:    { color: "#555", fontSize: 13, marginBottom: 20 },
  inputLabel:  { color: "#666", fontSize: 12, fontWeight: "700", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.8 },
  input: {
    backgroundColor: "#0a0a0a", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    color: "#fff", fontSize: 15, borderWidth: 1, borderColor: "#222", marginBottom: 16,
  },
  submitBtn: {
    backgroundColor: "#f59e0b", borderRadius: 16, paddingVertical: 16,
    alignItems: "center", justifyContent: "center",
  },
  submitBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },

  // Confirm modal
  confirmBg:      { flex: 1, backgroundColor: "rgba(0,0,0,0.82)", justifyContent: "center", padding: 24 },
  confirmDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  confirmSheet: {
    backgroundColor: "#111", borderRadius: 28, padding: 28,
    alignItems: "center", borderWidth: 1, borderColor: "#1e1e1e",
  },
  confirmIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "rgba(245,158,11,0.1)", borderWidth: 1, borderColor: "rgba(245,158,11,0.25)",
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  confirmTitle:  { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 8, textAlign: "center" },
  confirmBody:   { color: "#555", fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 24 },
  confirmBtns:   { flexDirection: "row", gap: 10, width: "100%" },
  confirmCancel: { flex: 1, backgroundColor: "#1a1a1a", borderRadius: 14, padding: 15, alignItems: "center" },
  confirmCancelText: { color: "#888", fontWeight: "700" },
  confirmAction: {
    flex: 1, backgroundColor: "#f59e0b",
    borderRadius: 14, padding: 15, alignItems: "center",
  },
  confirmActionText: { color: "#000", fontWeight: "900" },
  confirmClose: {
    flex: 1, backgroundColor: "#ef4444",
    borderRadius: 14, padding: 15, alignItems: "center",
  },
  confirmCloseText: { color: "#fff", fontWeight: "900" },
});
