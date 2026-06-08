import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomTabBar from "../components/bottom-tab-bar";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";
import { validateTournamentDescription, validateTournamentTitle } from "../../lib/validation";

// ─── Types ────────────────────────────────────────────────────────────────────

type Placement = { placement: number; username: string; user_id: string };

type BracketSlot  = { user_id: string; username: string; seed: number; status: string; eliminated_game: number | null; final_rank: number | null };
type BracketScore = { user_id: string; username: string; score: number; rank_in_game: number; is_eliminated: boolean };
type BracketGame  = { id: string; game_number: number; status: string; scores: BracketScore[] | null };
type BracketGroup = { id: string; group_number: number; status: string; slots: BracketSlot[] | null; games: BracketGame[] | null };
type BracketRound = { id: string; round_number: number; round_name: string; status: string; groups: BracketGroup[] | null };

type Tournament = {
  id: string; title: string; description: string | null;
  game_type: string | null; proposed_date: string | null;
  max_teams: number | null; is_official: boolean; status: string;
  is_individual: boolean; signup_type: string;
  created_by: string | null; is_owner: boolean;
  announcement: string | null;
  registered_count: number;
  signup_qr_active: boolean;
  max_players: number;
  ff_signup_time: string | null;
  ff_start_time: string | null;
  my_reg_status: "pending" | "accepted" | "denied" | null;
  placements: Placement[]; created_at: string;
};

type JoinRequest = { id: string; tournament_id: string; user_id: string; username: string };

type MyRequest = {
  id: string; title: string; game_type: string | null;
  proposed_date: string | null; status: string;
  admin_note: string | null; created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLACEMENT_MEDALS = ["🥇", "🥈", "🥉", "4️⃣"];

function getNextFirstFriday(): Date {
  const now = new Date();
  const ff = (y: number, m: number) => {
    const d = new Date(y, m, 1);
    return new Date(y, m, 1 + ((5 - d.getDay() + 7) % 7));
  };
  const thisMonth = ff(now.getFullYear(), now.getMonth());
  return thisMonth > now ? thisMonth : ff(now.getFullYear(), now.getMonth() + 1);
}

const GAME_TYPES = [
  "Skee-Ball", "Pinball", "Arcade", "Basketball", "Air Hockey", "Pool",
  "Magic: The Gathering", "Tekken", "Street Fighter", "Mortal Kombat", "Yu-Gi-Oh",
  "Other",
];

const STATUS_COLORS: Record<string, string> = {
  upcoming: "#06b6d4", active: "#22c55e", completed: "#555", cancelled: "#ef4444",
};

function fmtDate(iso: string | null) {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TournamentsScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [myRequests, setMyRequests] = useState<MyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);

  // Owner management
  const [managingTournament, setManagingTournament] = useState<Tournament | null>(null);
  const [announcementDraft, setAnnouncementDraft] = useState("");
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Tournament | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [actioningRequest, setActioningRequest] = useState<string | null>(null);

  // Bracket viewer
  const [viewBracketId, setViewBracketId]   = useState<string | null>(null);
  const [viewBracketData, setViewBracketData] = useState<{ rounds: BracketRound[] } | null>(null);
  const [viewBracketLoading, setViewBracketLoading] = useState(false);
  const [viewBracketTab, setViewBracketTab] = useState(1);

  // Request modal state
  const [requestVisible, setRequestVisible] = useState(false);
  const [reqTitle, setReqTitle] = useState("");
  const [reqDesc, setReqDesc] = useState("");
  const [reqGameType, setReqGameType] = useState("");
  const [reqDate, setReqDate] = useState("");
  const [reqMaxTeams, setReqMaxTeams] = useState("8");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function load() {
    if (!user) return;
    const [tourneysRes, myRegsRes, reqsRes] = await Promise.all([
      supabase.from("tournaments")
        .select("id, title, description, game_type, proposed_date, max_teams, is_official, is_individual, signup_type, status, created_by, announcement, signup_qr_active, max_players, ff_signup_time, ff_start_time, created_at")
        .order("proposed_date", { ascending: true, nullsFirst: false }),
      supabase.from("tournament_registrations").select("tournament_id, status").eq("user_id", user.id),
      supabase.from("tournament_requests").select("id, title, game_type, proposed_date, status, admin_note, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);

    // My registration status per tournament
    const myRegStatus: Record<string, "pending" | "accepted" | "denied"> = {};
    for (const r of myRegsRes.data ?? []) myRegStatus[(r as any).tournament_id] = (r as any).status;

    // Count of accepted registrations per tournament
    const { data: allRegs } = await supabase.from("tournament_registrations").select("tournament_id, status");
    const regCount: Record<string, number> = {};
    for (const r of allRegs ?? []) {
      if ((r as any).status === "accepted")
        regCount[(r as any).tournament_id] = (regCount[(r as any).tournament_id] ?? 0) + 1;
    }

    // Placements for completed tournaments
    const completedIds = (tourneysRes.data ?? []).filter((t: any) => t.status === "completed").map((t: any) => t.id);
    const placementsMap: Record<string, Placement[]> = {};
    if (completedIds.length > 0) {
      const { data: pData } = await supabase
        .from("tournament_placements")
        .select("tournament_id, placement, user_id, profiles(username)")
        .in("tournament_id", completedIds).order("placement");
      for (const p of pData ?? []) {
        const username = Array.isArray((p as any).profiles) ? (p as any).profiles[0]?.username : (p as any).profiles?.username;
        if (!placementsMap[(p as any).tournament_id]) placementsMap[(p as any).tournament_id] = [];
        placementsMap[(p as any).tournament_id].push({ placement: (p as any).placement, username: username ?? "Unknown", user_id: (p as any).user_id });
      }
    }

    const mapped: Tournament[] = (tourneysRes.data ?? []).map((t: any) => ({
      ...t,
      is_individual: t.is_individual ?? false,
      signup_type: t.signup_type ?? "app",
      created_by: t.created_by ?? null,
      announcement: t.announcement ?? null,
      is_owner: t.created_by === user.id,
      registered_count: regCount[t.id] ?? 0,
      signup_qr_active: t.signup_qr_active ?? false,
      max_players: t.max_players ?? 32,
      ff_signup_time: t.ff_signup_time ?? null,
      ff_start_time: t.ff_start_time ?? null,
      my_reg_status: myRegStatus[t.id] ?? null,
      placements: placementsMap[t.id] ?? [],
    }));
    setTournaments(mapped);

    // Pending join requests for tournaments the user owns
    const ownedIds = mapped.filter((t) => t.is_owner).map((t) => t.id);
    if (ownedIds.length > 0) {
      const { data: jrData } = await supabase
        .from("tournament_registrations")
        .select("id, tournament_id, user_id, profiles(username)")
        .in("tournament_id", ownedIds).eq("status", "pending");
      setJoinRequests((jrData ?? []).map((r: any) => ({
        id: r.id, tournament_id: r.tournament_id, user_id: r.user_id,
        username: Array.isArray(r.profiles) ? r.profiles[0]?.username : r.profiles?.username ?? "Unknown",
      })));
    } else {
      setJoinRequests([]);
    }

    setMyRequests((reqsRes.data ?? []).filter((r: any) => r.status === "pending"));
    setLoading(false);
    setRefreshing(false);
  }

  useFocusEffect(useCallback(() => { if (user) load(); }, [user]));

  async function openBracket(tournId: string, defaultTab = 1) {
    setViewBracketId(tournId);
    setViewBracketTab(defaultTab);
    setViewBracketLoading(true);
    setViewBracketData(null);
    const { data } = await supabase.rpc("rpc_ff_get_bracket", { p_tournament_id: tournId });
    if (data) {
      setViewBracketData(data as any);
      const rounds: BracketRound[] = (data as any)?.rounds ?? [];
      const activeRound = rounds.find(r => r.status === "in_progress") ?? rounds[rounds.length - 1];
      if (activeRound) setViewBracketTab(activeRound.round_number);
    }
    setViewBracketLoading(false);
  }

  async function handleRegister(id: string) {
    if (!user) return;
    const t = tournaments.find((t) => t.id === id);
    const status = t?.is_official ? "accepted" : "pending";
    await supabase.from("tournament_registrations").insert({ tournament_id: id, user_id: user.id, status });
    load();
  }

  async function handleUnregister(id: string) {
    if (!user) return;
    await supabase.from("tournament_registrations").delete().eq("tournament_id", id).eq("user_id", user.id);
    load();
  }

  function openManage(t: Tournament) {
    setManagingTournament(t);
    setAnnouncementDraft(t.announcement ?? "");
  }

  async function handleAcceptRequest(reqId: string) {
    setActioningRequest(reqId);
    await supabase.from("tournament_registrations").update({ status: "accepted" }).eq("id", reqId);
    setJoinRequests((prev) => prev.filter((r) => r.id !== reqId));
    setActioningRequest(null);
    load();
  }

  async function handleDenyRequest(reqId: string) {
    setActioningRequest(reqId);
    await supabase.from("tournament_registrations").update({ status: "denied" }).eq("id", reqId);
    setJoinRequests((prev) => prev.filter((r) => r.id !== reqId));
    setActioningRequest(null);
  }

  async function handleSaveAnnouncement() {
    if (!managingTournament) return;
    setSavingAnnouncement(true);
    await supabase.from("tournaments")
      .update({ announcement: announcementDraft.trim() || null, announcement_updated_at: new Date().toISOString() })
      .eq("id", managingTournament.id);
    setSavingAnnouncement(false);
    setManagingTournament(null);
    load();
  }

  async function handleCancelTournament() {
    if (!cancelTarget) return;
    setCancelling(true);
    await supabase.from("tournaments").update({ status: "cancelled" }).eq("id", cancelTarget.id);
    setCancelling(false);
    setCancelTarget(null);
    load();
  }

  async function handleSubmitRequest() {
    setSubmitError(null);
    const safeTitle = validateTournamentTitle(reqTitle);
    const safeDescription = validateTournamentDescription(reqDesc);
    if (!user || !safeTitle.ok || !safeDescription.ok) {
      setSubmitError(!safeTitle.ok ? safeTitle.error : !safeDescription.ok ? safeDescription.error : null);
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("tournament_requests").insert({
      user_id: user.id,
      title: safeTitle.value,
      description: safeDescription.value || null,
      game_type: reqGameType || null,
      proposed_date: (() => { if (!reqDate.trim()) return null; const d = new Date(reqDate); return isNaN(d.getTime()) ? null : d.toISOString(); })(),
      max_teams: parseInt(reqMaxTeams, 10) || 8,
      status: "pending",
    });
    setSubmitting(false);
    if (error) { setSubmitError(error.message); return; }
    setRequestVisible(false);
    setReqTitle(""); setReqDesc(""); setReqGameType(""); setReqDate(""); setReqMaxTeams("8");
    router.replace("/" as any);
  }

  if (authLoading || loading) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  const official  = tournaments.filter(t => t.is_official && !t.is_individual && t.status !== "cancelled");
  const community = tournaments.filter(t => !t.is_official && !["cancelled", "completed"].includes(t.status));
  const completed = tournaments.filter(t => t.status === "completed" && !t.is_individual);

  return (
    <View style={s.root}>
      <SafeAreaView style={s.safe} edges={["top"]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#06b6d4" />}
        >
          <View style={s.content}>
            {/* Header */}
            <View style={s.header}>
              <View>
                <Text style={s.pageTitle}>Tournaments</Text>
                <Text style={s.pageSub}>Compete for glory</Text>
              </View>
              <Pressable style={s.requestBtn} onPress={() => { setSubmitError(null); setRequestVisible(true); }}>
                <Ionicons name="add" size={16} color="#000" />
                <Text style={s.requestBtnText}>Request</Text>
              </Pressable>
            </View>

            {/* First Friday Skee-Ball — always shown */}
            {(() => {
              const nextFF = getNextFirstFriday();
              const ffTourneys = tournaments.filter((t) => t.is_individual && t.game_type === "Skee-Ball");
              const completedFF = ffTourneys.filter((t) => t.status === "completed").slice(0, 3);
              const activeFF = ffTourneys.find((t) => t.status === "upcoming" || t.status === "active");
              const isFull = activeFF ? activeFF.registered_count >= activeFF.max_players : false;
              return (
                <View style={s.ffCard}>
                  <View style={s.ffTopRow}>
                    <View style={s.ffIconWrap}>
                      <Ionicons name={"bowling-ball-outline" as any} size={22} color="#06b6d4" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.ffTitle}>First Friday Skee-Ball</Text>
                      <Text style={s.ffSub}>Individual · Monthly recurring tournament</Text>
                    </View>
                    <View style={s.ffBadge}>
                      <Text style={s.ffBadgeText}>Monthly</Text>
                    </View>
                  </View>

                  <View style={s.ffDateRow}>
                    <Ionicons name="calendar-outline" size={13} color="#444" />
                    <Text style={s.ffDateText}>
                      Next: {nextFF.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                    </Text>
                  </View>

                  {activeFF && (activeFF.ff_signup_time || activeFF.ff_start_time) && (
                    <View style={s.ffTimesRow}>
                      {activeFF.ff_signup_time && (
                        <View style={s.ffTimeChip}>
                          <Ionicons name="enter-outline" size={12} color="#06b6d4" />
                          <Text style={s.ffTimeLabel}>Sign-up</Text>
                          <Text style={s.ffTimeValue}>{activeFF.ff_signup_time}</Text>
                        </View>
                      )}
                      {activeFF.ff_start_time && (
                        <View style={s.ffTimeChip}>
                          <Ionicons name="play-outline" size={12} color="#a855f7" />
                          <Text style={[s.ffTimeLabel, { color: "#a855f7" }]}>Start</Text>
                          <Text style={[s.ffTimeValue, { color: "#a855f7" }]}>{activeFF.ff_start_time}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {activeFF && (
                    <View style={s.ffSignupRow}>
                      <View style={s.ffPlayersChip}>
                        <Ionicons name="people-outline" size={12} color="#555" />
                        <Text style={s.ffPlayersText}>{activeFF.registered_count}/{activeFF.max_players} players</Text>
                      </View>
                      <View style={[
                        s.ffStatusChip,
                        isFull
                          ? { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.2)" }
                          : activeFF.signup_qr_active
                            ? { backgroundColor: "rgba(34,197,94,0.08)", borderColor: "rgba(34,197,94,0.2)" }
                            : { backgroundColor: "rgba(85,85,85,0.08)", borderColor: "rgba(85,85,85,0.2)" },
                      ]}>
                        <View style={[
                          s.ffStatusDot,
                          { backgroundColor: isFull ? "#ef4444" : activeFF.signup_qr_active ? "#22c55e" : "#444" },
                        ]} />
                        <Text style={[
                          s.ffStatusChipText,
                          { color: isFull ? "#ef4444" : activeFF.signup_qr_active ? "#22c55e" : "#444" },
                        ]}>
                          {isFull ? "FULL" : activeFF.signup_qr_active ? "SIGN-UP OPEN" : "SIGN-UP CLOSED"}
                        </Text>
                      </View>
                    </View>
                  )}

                  <View style={s.ffInPersonRow}>
                    <Ionicons name="location-outline" size={13} color="#06b6d4" />
                    <Text style={s.ffInPersonText}>Sign up in person at the venue on the day of the event</Text>
                  </View>

                  <Pressable style={s.ffViewSeriesBtn} onPress={() => router.push("/ff-tournament" as any)}>
                    <Ionicons name="trophy-outline" size={14} color="#06b6d4" />
                    <Text style={s.ffViewSeriesText}>View Series & Hall of Champions</Text>
                    <Ionicons name="chevron-forward" size={14} color="#06b6d4" />
                  </Pressable>

                  {activeFF && activeFF.status === "active" && (
                    <Pressable style={s.ffViewBracketBtn} onPress={() => openBracket(activeFF.id)}>
                      <View style={s.ffLiveDot} />
                      <Text style={s.ffViewBracketText}>Live Bracket</Text>
                      <Ionicons name="chevron-forward" size={14} color="#a855f7" />
                    </Pressable>
                  )}

                  {completedFF.length > 0 && (
                    <>
                      <View style={s.ffResultsDivider} />
                      <Text style={s.ffResultsLabel}>PAST CHAMPIONS</Text>
                      {completedFF.map((t) => (
                        <View key={t.id} style={s.ffResultRow}>
                          <Text style={s.ffResultDate}>
                            {t.proposed_date
                              ? new Date(t.proposed_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })
                              : "—"}
                          </Text>
                          <View style={s.ffPodium}>
                            {t.placements.slice(0, 4).map((p) => (
                              <Text key={p.placement} style={s.ffPodiumEntry}>
                                {PLACEMENT_MEDALS[p.placement - 1] ?? `#${p.placement}`} {p.username}
                              </Text>
                            ))}
                          </View>
                          <Pressable style={s.ffResultsViewBtn} onPress={() => openBracket(t.id, 4)}>
                            <Text style={s.ffResultsViewBtnText}>Results</Text>
                            <Ionicons name="chevron-forward" size={11} color="#555" />
                          </Pressable>
                        </View>
                      ))}
                    </>
                  )}
                </View>
              );
            })()}

            {/* Official */}
            {official.length > 0 && (
              <>
                <View style={s.sectionRow}>
                  <Ionicons name="shield-checkmark" size={13} color="#f59e0b" />
                  <Text style={[s.sectionLabel, { color: "#f59e0b" }]}>OFFICIAL TOURNAMENTS</Text>
                </View>
                {official.map(t => <TournamentCard key={t.id} t={t} onRegister={handleRegister} onUnregister={handleUnregister} onManage={openManage} />)}
              </>
            )}

            {/* Community */}
            {community.length > 0 && (
              <>
                <View style={s.sectionRow}>
                  <Ionicons name="people" size={13} color="#06b6d4" />
                  <Text style={s.sectionLabel}>COMMUNITY</Text>
                </View>
                {community.map(t => <TournamentCard key={t.id} t={t} onRegister={handleRegister} onUnregister={handleUnregister} onManage={openManage} />)}
              </>
            )}

            {official.length === 0 && community.length === 0 && (
              <View style={s.emptyCard}>
                <Ionicons name="trophy-outline" size={44} color="#222" style={{ marginBottom: 12 }} />
                <Text style={s.emptyTitle}>No tournaments yet</Text>
                <Text style={s.emptySub}>Submit a request and the admin will review it.</Text>
                <Pressable style={s.emptyBtn} onPress={() => setRequestVisible(true)}>
                  <Text style={s.emptyBtnText}>Request a Tournament</Text>
                </Pressable>
              </View>
            )}

            {/* Past */}
            {completed.length > 0 && (
              <>
                <View style={[s.sectionRow, { marginTop: 8 }]}>
                  <Ionicons name="checkmark-done" size={13} color="#444" />
                  <Text style={[s.sectionLabel, { color: "#444" }]}>PAST TOURNAMENTS</Text>
                </View>
                {completed.map(t => <TournamentCard key={t.id} t={t} onRegister={handleRegister} onUnregister={handleUnregister} onManage={openManage} />)}
              </>
            )}

            {/* My requests */}
            {myRequests.length > 0 && (
              <>
                <View style={[s.sectionRow, { marginTop: 8 }]}>
                  <Ionicons name="document-text-outline" size={13} color="#555" />
                  <Text style={[s.sectionLabel, { color: "#555" }]}>MY REQUESTS</Text>
                </View>
                {myRequests.map(r => (
                  <View key={r.id} style={s.reqCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.reqTitle}>{r.title}</Text>
                      <Text style={s.reqMeta}>{r.game_type ?? "Any game"} · {fmtDate(r.proposed_date)}</Text>
                      {r.admin_note ? <Text style={s.reqNote}>Admin: {r.admin_note}</Text> : null}
                    </View>
                    <View style={[s.reqBadge, { backgroundColor: r.status === "approved" ? "rgba(34,197,94,0.1)" : r.status === "denied" ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)" }]}>
                      <Text style={[s.reqBadgeText, { color: r.status === "approved" ? "#22c55e" : r.status === "denied" ? "#ef4444" : "#f59e0b" }]}>
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
      <BottomTabBar />

      {/* Owner Management Modal */}
      <Modal visible={managingTournament !== null} transparent animationType="slide" onRequestClose={() => setManagingTournament(null)}>
        <View style={s.modalBg}>
          <Pressable style={s.modalDismiss} onPress={() => setManagingTournament(null)} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <View style={s.modalTopRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={s.modalTitle}>Manage Tournament</Text>
                <Text style={s.modalSub} numberOfLines={1}>{managingTournament?.title}</Text>
              </View>
              <Pressable onPress={() => setManagingTournament(null)}>
                <Ionicons name="close" size={22} color="#555" />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              <Text style={s.fieldLabel}>Announcement</Text>
              <Text style={s.manageSubLabel}>Share meeting location, rules, or updates with participants</Text>
              <TextInput
                style={[s.input, s.textArea, { height: 120 }]}
                placeholder={"e.g. We'll be at lanes 4-6. Arrive 15 min early. Bring your A-game!"}
                placeholderTextColor="#333"
                value={announcementDraft}
                onChangeText={(v) => setAnnouncementDraft(v.slice(0, 1000))}
                multiline
                numberOfLines={5}
                maxLength={1000}
                textAlignVertical="top"
              />
              <Text style={s.charCounter}>{announcementDraft.length}/1000</Text>
              <Pressable
                style={[s.modalConfirm, savingAnnouncement && s.modalConfirmOff]}
                onPress={handleSaveAnnouncement}
                disabled={savingAnnouncement}
              >
                <Text style={s.modalConfirmText}>{savingAnnouncement ? "Saving…" : "Save Announcement"}</Text>
              </Pressable>

              <Text style={[s.fieldLabel, { marginTop: 28 }]}>Join Requests</Text>
              {joinRequests.filter((r) => r.tournament_id === managingTournament?.id).length === 0 ? (
                <View style={s.noRequestsRow}>
                  <Ionicons name="people-outline" size={16} color="#333" />
                  <Text style={s.noRequestsText}>No pending join requests</Text>
                </View>
              ) : (
                joinRequests
                  .filter((r) => r.tournament_id === managingTournament?.id)
                  .map((r) => (
                    <View key={r.id} style={s.joinReqRow}>
                      <View style={s.joinReqAvatar}>
                        <Text style={s.joinReqAvatarText}>{r.username.charAt(0).toUpperCase()}</Text>
                      </View>
                      <Text style={s.joinReqName}>{r.username}</Text>
                      <View style={s.joinReqActions}>
                        <Pressable
                          style={[s.joinAcceptBtn, actioningRequest === r.id && s.modalConfirmOff]}
                          onPress={() => handleAcceptRequest(r.id)}
                          disabled={actioningRequest !== null}
                        >
                          <Text style={s.joinAcceptText}>Accept</Text>
                        </Pressable>
                        <Pressable
                          style={[s.joinDenyBtn, actioningRequest === r.id && s.modalConfirmOff]}
                          onPress={() => handleDenyRequest(r.id)}
                          disabled={actioningRequest !== null}
                        >
                          <Text style={s.joinDenyText}>Deny</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
              )}

              <View style={s.dangerZone}>
                <Text style={s.dangerZoneLabel}>DANGER ZONE</Text>
                <Pressable
                  style={s.cancelTournBtn}
                  onPress={() => { setCancelTarget(managingTournament); setManagingTournament(null); }}
                >
                  <Ionicons name="trash-outline" size={15} color="#ef4444" />
                  <Text style={s.cancelTournText}>Cancel Tournament</Text>
                </Pressable>
              </View>
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Cancel confirmation modal */}
      <Modal visible={cancelTarget !== null} transparent animationType="fade" onRequestClose={() => setCancelTarget(null)}>
        <View style={s.confirmBg}>
          <View style={s.confirmCard}>
            <View style={s.confirmIconWrap}>
              <Ionicons name="warning-outline" size={32} color="#ef4444" />
            </View>
            <Text style={s.confirmTitle}>Cancel Tournament?</Text>
            <Text style={s.confirmBody}>
              {"This will permanently cancel "}
              <Text style={{ color: "#fff", fontWeight: "800" }}>{cancelTarget?.title}</Text>
              {". This cannot be undone."}
            </Text>
            <View style={s.confirmBtns}>
              <Pressable style={s.confirmKeep} onPress={() => setCancelTarget(null)}>
                <Text style={s.confirmKeepText}>Keep It</Text>
              </Pressable>
              <Pressable
                style={[s.confirmDelete, cancelling && s.modalConfirmOff]}
                onPress={handleCancelTournament}
                disabled={cancelling}
              >
                <Text style={s.confirmDeleteText}>{cancelling ? "Cancelling…" : "Yes, Cancel"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Request modal */}
      <Modal visible={requestVisible} transparent animationType="slide" onRequestClose={() => setRequestVisible(false)}>
        <View style={s.modalBg}>
          <Pressable style={s.modalDismiss} onPress={() => setRequestVisible(false)} />
          <View style={s.modalSheet}>
            <View style={s.modalHandle} />
            <View style={s.modalTopRow}>
              <View>
                <Text style={s.modalTitle}>Request Tournament</Text>
                <Text style={s.modalSub}>Submit for admin approval</Text>
              </View>
              <Pressable onPress={() => setRequestVisible(false)}>
                <Ionicons name="close" size={22} color="#555" />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={s.fieldLabel}>Tournament Name *</Text>
              <TextInput style={s.input} placeholder="e.g. Spring Skee-Ball Open" placeholderTextColor="#333" value={reqTitle} onChangeText={setReqTitle} />

              <Text style={s.fieldLabel}>Description</Text>
              <TextInput style={[s.input, s.textArea]} placeholder="Format, rules, prizes…" placeholderTextColor="#333" value={reqDesc} onChangeText={setReqDesc} multiline numberOfLines={3} />

              <Text style={s.fieldLabel}>Game Type</Text>
              <View style={s.chipWrap}>
                {GAME_TYPES.map(gt => (
                  <Pressable key={gt} style={[s.chip, reqGameType === gt && s.chipActive]} onPress={() => setReqGameType(reqGameType === gt ? "" : gt)}>
                    <Text style={[s.chipText, reqGameType === gt && s.chipTextActive]}>{gt}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={s.fieldLabel}>Proposed Date</Text>
              <TextInput
                style={s.input}
                placeholder="MM/DD/YYYY"
                placeholderTextColor="#333"
                value={reqDate}
                keyboardType="number-pad"
                maxLength={10}
                onChangeText={(raw) => {
                  const digits = raw.replace(/\D/g, "").slice(0, 8);
                  let out = digits;
                  if (digits.length > 4) out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
                  else if (digits.length > 2) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
                  setReqDate(out);
                }}
              />

              <Text style={s.fieldLabel}>Max Teams</Text>
              <TextInput style={s.input} placeholder="8" placeholderTextColor="#333" keyboardType="number-pad" value={reqMaxTeams} onChangeText={setReqMaxTeams} />

              {submitError && (
                <View style={s.errorRow}>
                  <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
                  <Text style={s.errorText}>{submitError}</Text>
                </View>
              )}
              <View style={s.modalBtns}>
                <Pressable style={s.modalCancel} onPress={() => setRequestVisible(false)}>
                  <Text style={s.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={[s.modalConfirm, (!reqTitle.trim() || submitting) && s.modalConfirmOff]} onPress={handleSubmitRequest} disabled={!reqTitle.trim() || submitting}>
                  <Text style={s.modalConfirmText}>{submitting ? "Submitting…" : "Submit Request"}</Text>
                </Pressable>
              </View>
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Bracket viewer */}
      <Modal visible={viewBracketId !== null} transparent animationType="slide" onRequestClose={() => setViewBracketId(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setViewBracketId(null)} />
          <View style={{ backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 1, borderColor: "#1e1e1e", height: "92%" }}>
            {/* Header */}
            <View style={s.bvHeader}>
              <View>
                <Text style={s.bvTitle}>Bracket</Text>
                {viewBracketData?.rounds?.some(r => r.status === "in_progress") && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                    <View style={s.bvLiveDot} />
                    <Text style={{ color: "#ef4444", fontSize: 11, fontWeight: "800" }}>LIVE</Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <Pressable onPress={() => viewBracketId && openBracket(viewBracketId, viewBracketTab)} style={{ padding: 8 }}>
                  <Ionicons name="refresh" size={18} color="#555" />
                </Pressable>
                <Pressable onPress={() => setViewBracketId(null)}>
                  <Ionicons name="close-circle" size={26} color="#444" />
                </Pressable>
              </View>
            </View>

            {/* Round tabs */}
            {viewBracketData?.rounds && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44 }} contentContainerStyle={s.bvRoundTabs}>
                {viewBracketData.rounds.map(r => (
                  <Pressable
                    key={r.round_number}
                    style={[s.bvRoundTab, viewBracketTab === r.round_number && s.bvRoundTabActive]}
                    onPress={() => setViewBracketTab(r.round_number)}
                  >
                    <Text style={[s.bvRoundTabText, viewBracketTab === r.round_number && { color: "#a855f7" }]}>{r.round_name}</Text>
                    <View style={[s.bvRoundDot, {
                      backgroundColor: r.status === "in_progress" ? "#f59e0b" : r.status === "completed" ? "#22c55e" : "#333",
                    }]} />
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {viewBracketLoading ? (
              <ActivityIndicator color="#a855f7" style={{ marginTop: 40 }} />
            ) : (
              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

                {/* Final standings banner */}
                {(() => {
                  const finalRound = viewBracketData?.rounds?.find(r => r.round_number === 4);
                  if (finalRound?.status !== "completed") return null;
                  const winners = [...((finalRound?.groups?.[0]?.slots ?? []) as BracketSlot[])]
                    .filter(sl => sl.final_rank != null)
                    .sort((a, b) => (a.final_rank ?? 0) - (b.final_rank ?? 0));
                  if (winners.length === 0) return null;
                  return (
                    <View style={s.bvWinnersCard}>
                      <Text style={s.bvWinnersTitle}>🏆 Final Standings</Text>
                      {winners.map(w => (
                        <View key={w.seed} style={s.bvWinnerRow}>
                          <Text style={s.bvWinnerMedal}>
                            {w.final_rank === 1 ? "🥇" : w.final_rank === 2 ? "🥈" : w.final_rank === 3 ? "🥉" : "4️⃣"}
                          </Text>
                          <Text style={[s.bvWinnerName, w.final_rank === 1 && { color: "#f59e0b" }]}>{w.username}</Text>
                        </View>
                      ))}
                    </View>
                  );
                })()}

                {/* Round groups */}
                {(() => {
                  const round = viewBracketData?.rounds?.find(r => r.round_number === viewBracketTab);
                  if (!round) return <Text style={{ color: "#444", textAlign: "center", marginTop: 40, fontSize: 14 }}>Round not yet started</Text>;
                  return (round.groups ?? []).map(g => (
                    <View key={g.id} style={s.bvGroupCard}>
                      <View style={s.bvGroupHeader}>
                        <Text style={s.bvGroupTitle}>Group {g.group_number}</Text>
                        <View style={[s.bvGroupBadge, {
                          backgroundColor: g.status === "completed" ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)",
                          borderColor: g.status === "completed" ? "rgba(34,197,94,0.3)" : "rgba(245,158,11,0.3)",
                        }]}>
                          <Text style={{ color: g.status === "completed" ? "#22c55e" : "#f59e0b", fontSize: 10, fontWeight: "800" }}>
                            {g.status === "completed" ? "DONE" : g.status === "game2" ? "GAME 2" : "GAME 1"}
                          </Text>
                        </View>
                      </View>
                      {(g.slots ?? []).map(sl => (
                        <View key={`${sl.user_id}_${sl.seed}`} style={s.bvSlotRow}>
                          <Ionicons
                            name={sl.status === "eliminated" ? "close-circle" : sl.status === "advanced" ? "checkmark-circle" : "ellipse"}
                            size={14}
                            color={sl.status === "eliminated" ? "#ef4444" : sl.status === "advanced" ? "#22c55e" : "#555"}
                          />
                          <Text style={[s.bvSlotName, sl.status === "eliminated" && { color: "#333", textDecorationLine: "line-through" }]}>
                            {sl.username}
                          </Text>
                          {sl.final_rank != null && <Text style={s.bvSlotRank}>#{sl.final_rank}</Text>}
                          {sl.eliminated_game != null && <Text style={s.bvSlotElim}>out g{sl.eliminated_game}</Text>}
                        </View>
                      ))}
                      {(g.games ?? []).filter(gm => gm.status === "completed" && gm.scores).map(gm => (
                        <View key={gm.id} style={s.bvGameResult}>
                          <Text style={s.bvGameResultLabel}>Game {gm.game_number}</Text>
                          {(gm.scores ?? []).map((sc, idx) => (
                            <Text key={`${sc.user_id}_${idx}`} style={[s.bvGameScore, sc.is_eliminated && { color: "#ef4444" }]}>
                              {sc.username}: {sc.score.toLocaleString()}{sc.is_eliminated ? "  ✗" : ""}
                            </Text>
                          ))}
                        </View>
                      ))}
                    </View>
                  ));
                })()}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Tournament Card ──────────────────────────────────────────────────────────

function TournamentCard({ t, onRegister, onUnregister, onManage }: {
  t: Tournament;
  onRegister: (id: string) => void;
  onUnregister: (id: string) => void;
  onManage: (t: Tournament) => void;
}) {
  const statusColor = STATUS_COLORS[t.status] ?? "#555";
  const isFull = t.max_teams != null && t.registered_count >= t.max_teams;
  const top3 = t.placements.slice(0, 3);
  const joinLabel = t.is_official ? "Register" : "Request to Join";

  return (
    <View style={[s.card, t.is_official && s.cardOfficial]}>
      <View style={s.cardTitleRow}>
        {t.is_official && (
          <View style={s.officialBadge}>
            <Ionicons name="shield-checkmark" size={10} color="#f59e0b" />
            <Text style={s.officialBadgeText}>Official</Text>
          </View>
        )}
        {t.is_owner && (
          <View style={s.ownerBadge}>
            <Ionicons name="person" size={10} color="#06b6d4" />
            <Text style={s.ownerBadgeText}>Owner</Text>
          </View>
        )}
        <View style={[s.statusBadge, { backgroundColor: statusColor + "15", borderColor: statusColor + "35" }]}>
          <Text style={[s.statusText, { color: statusColor }]}>{t.status.charAt(0).toUpperCase() + t.status.slice(1)}</Text>
        </View>
      </View>

      <Text style={s.cardTitle}>{t.title}</Text>
      {t.description ? <Text style={s.cardDesc} numberOfLines={2}>{t.description}</Text> : null}

      <View style={s.metaRow}>
        {t.game_type && (
          <View style={s.metaChip}>
            <Ionicons name="game-controller-outline" size={11} color="#555" />
            <Text style={s.metaText}>{t.game_type}</Text>
          </View>
        )}
        <View style={s.metaChip}>
          <Ionicons name="calendar-outline" size={11} color="#555" />
          <Text style={s.metaText}>{fmtDate(t.proposed_date)}</Text>
        </View>
        <View style={s.metaChip}>
          <Ionicons name="people-outline" size={11} color="#555" />
          <Text style={s.metaText}>{t.registered_count}{t.max_teams ? `/${t.max_teams}` : ""} teams</Text>
        </View>
      </View>

      {t.announcement ? (
        <View style={s.announcementBox}>
          <View style={s.announcementHeader}>
            <Ionicons name="megaphone-outline" size={12} color="#06b6d4" />
            <Text style={s.announcementLabel}>ANNOUNCEMENT</Text>
          </View>
          <Text style={s.announcementText}>{t.announcement}</Text>
        </View>
      ) : null}

      {t.status === "upcoming" && !t.is_individual && (
        <View style={s.cardFooter}>
          {t.is_owner ? (
            <Pressable style={s.manageBtn} onPress={() => onManage(t)}>
              <Ionicons name="settings-outline" size={14} color="#06b6d4" />
              <Text style={s.manageBtnText}>Manage Tournament</Text>
            </Pressable>
          ) : t.my_reg_status === "accepted" ? (
            <View style={s.regRow}>
              <View style={s.regBadge}>
                <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
                <Text style={s.regText}>Registered</Text>
              </View>
              <Pressable style={s.unregBtn} onPress={() => onUnregister(t.id)}>
                <Text style={s.unregText}>Cancel</Text>
              </Pressable>
            </View>
          ) : t.my_reg_status === "pending" ? (
            <View style={s.regRow}>
              <View style={s.regBadge}>
                <Ionicons name="time-outline" size={14} color="#f59e0b" />
                <Text style={[s.regText, { color: "#f59e0b" }]}>Request Pending</Text>
              </View>
              <Pressable style={s.unregBtn} onPress={() => onUnregister(t.id)}>
                <Text style={s.unregText}>Withdraw</Text>
              </Pressable>
            </View>
          ) : t.my_reg_status === "denied" ? (
            <View style={s.regBadge}>
              <Ionicons name="close-circle" size={14} color="#ef4444" />
              <Text style={[s.regText, { color: "#ef4444" }]}>Request Denied</Text>
            </View>
          ) : (
            <Pressable
              style={[s.registerBtn, isFull && s.registerBtnOff]}
              onPress={() => !isFull && onRegister(t.id)}
              disabled={isFull}
            >
              <Text style={[s.registerBtnText, isFull && { color: "#444" }]}>
                {isFull ? "Full" : joinLabel}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {t.status === "completed" && top3.length > 0 && (
        <View style={s.podiumSection}>
          <View style={s.podiumDivider} />
          {top3.map((p) => (
            <View key={p.placement} style={s.podiumRow}>
              <Text style={s.podiumMedal}>{PLACEMENT_MEDALS[p.placement - 1] ?? `#${p.placement}`}</Text>
              <Text style={s.podiumName}>{p.username}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  safe: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 28 },

  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 },
  pageTitle: { color: "#fff", fontSize: 32, fontWeight: "900", letterSpacing: -0.5 },
  pageSub: { color: "#555", fontSize: 14, marginTop: 2 },
  requestBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#06b6d4", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  requestBtnText: { color: "#000", fontWeight: "800", fontSize: 14 },

  sectionRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 12 },
  sectionLabel: { color: "#06b6d4", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.4 },

  emptyCard: { backgroundColor: "#0d0d0d", borderRadius: 22, padding: 40, alignItems: "center", borderWidth: 1, borderColor: "#1a1a1a", marginTop: 8 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "900", marginBottom: 6 },
  emptySub: { color: "#444", fontSize: 14, textAlign: "center", marginBottom: 20 },
  emptyBtn: { backgroundColor: "#06b6d4", borderRadius: 14, paddingHorizontal: 22, paddingVertical: 12 },
  emptyBtnText: { color: "#000", fontWeight: "900", fontSize: 14 },

  card: { backgroundColor: "#111", borderRadius: 20, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: "#1e1e1e" },
  cardOfficial: { borderColor: "rgba(245,158,11,0.3)", backgroundColor: "#110f0a" },
  cardTitleRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  officialBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(245,158,11,0.1)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: "rgba(245,158,11,0.25)" },
  officialBadgeText: { color: "#f59e0b", fontSize: 10, fontWeight: "800" },
  statusBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  statusText: { fontSize: 10, fontWeight: "800" },
  cardTitle: { color: "#fff", fontSize: 18, fontWeight: "900", marginBottom: 6 },
  cardDesc: { color: "#555", fontSize: 13, lineHeight: 19, marginBottom: 12 },

  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 14 },
  metaChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#0d0d0d", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: "#1a1a1a" },
  metaText: { color: "#555", fontSize: 12 },

  cardFooter: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a", paddingTop: 14 },
  regRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  regBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
  regText: { color: "#22c55e", fontWeight: "700", fontSize: 14 },
  unregBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: "#2a2a2a" },
  unregText: { color: "#555", fontSize: 13, fontWeight: "700" },
  registerBtn: { backgroundColor: "#06b6d4", borderRadius: 13, paddingVertical: 12, alignItems: "center" },
  registerBtnOff: { backgroundColor: "#1a1a1a" },
  registerBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },

  reqCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: "#0d0d0d", borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#1a1a1a" },
  reqTitle: { color: "#fff", fontSize: 14, fontWeight: "800", marginBottom: 3 },
  reqMeta: { color: "#444", fontSize: 12 },
  reqNote: { color: "#f59e0b", fontSize: 12, marginTop: 4 },
  reqBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  reqBadgeText: { fontSize: 12, fontWeight: "800" },

  // First Friday card
  ffCard: { backgroundColor: "rgba(6,182,212,0.05)", borderRadius: 20, borderWidth: 1, borderColor: "rgba(6,182,212,0.2)", padding: 18, marginBottom: 20 },
  ffTopRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  ffIconWrap: { width: 46, height: 46, borderRadius: 14, backgroundColor: "rgba(6,182,212,0.1)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(6,182,212,0.2)" },
  ffTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },
  ffSub: { color: "#444", fontSize: 12, marginTop: 1 },
  ffBadge: { backgroundColor: "rgba(6,182,212,0.1)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(6,182,212,0.25)" },
  ffBadgeText: { color: "#06b6d4", fontSize: 10, fontWeight: "800" },
  ffDateRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 8 },
  ffDateText: { color: "#888", fontSize: 13, fontWeight: "600" },
  ffInPersonRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  ffInPersonText: { color: "#06b6d4", fontSize: 12, fontWeight: "600", flex: 1 },
  ffSignupRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" },
  ffPlayersChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#0d0d0d", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: "#1a1a1a" },
  ffPlayersText: { color: "#555", fontSize: 12, fontWeight: "600" },
  ffStatusChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1 },
  ffStatusDot: { width: 6, height: 6, borderRadius: 3 },
  ffStatusChipText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  ffTimesRow: { flexDirection: "row", gap: 10, marginBottom: 10, flexWrap: "wrap" },
  ffTimeChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(6,182,212,0.07)", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: "rgba(6,182,212,0.18)" },
  ffTimeLabel: { color: "#06b6d4", fontSize: 11, fontWeight: "700" },
  ffTimeValue: { color: "#06b6d4", fontSize: 12, fontWeight: "900" },

  ffViewSeriesBtn: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, backgroundColor: "rgba(6,182,212,0.06)", borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: "rgba(6,182,212,0.18)" },
  ffViewSeriesText: { flex: 1, color: "#06b6d4", fontSize: 13, fontWeight: "700" },
  ffResultsDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(6,182,212,0.15)", marginVertical: 14 },
  ffResultsLabel: { color: "#333", fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 10 },
  ffResultRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 10 },
  ffResultDate: { color: "#444", fontSize: 12, fontWeight: "700", minWidth: 56 },
  ffPodium: { flex: 1, gap: 2 },
  ffPodiumEntry: { color: "#fff", fontSize: 13 },

  // Podium on completed cards
  podiumSection: { marginTop: 0 },
  podiumDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#1a1a1a", marginBottom: 12 },
  podiumRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 5 },
  podiumMedal: { fontSize: 16 },
  podiumName: { color: "#fff", fontSize: 14, fontWeight: "700" },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  modalSheet: { backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 16, paddingBottom: Platform.OS === "ios" ? 36 : 24, borderTopWidth: 1, borderColor: "#1e1e1e", maxHeight: "90%" },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 20 },
  modalTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "900" },
  modalSub: { color: "#555", fontSize: 13, marginTop: 2 },
  fieldLabel: { color: "#444", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8, marginTop: 14 },
  input: { backgroundColor: "#0a0a0a", color: "#fff", padding: 15, borderRadius: 14, fontSize: 15, borderWidth: 1, borderColor: "#1e1e1e" },
  textArea: { height: 80, textAlignVertical: "top", paddingTop: 12 },
  chipRow: { gap: 8, paddingVertical: 4 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "#1a1a1a", borderWidth: 1, borderColor: "#2a2a2a" },
  chipActive: { backgroundColor: "rgba(6,182,212,0.12)", borderColor: "#06b6d4" },
  chipText: { color: "#555", fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: "#06b6d4", fontWeight: "800" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 10, padding: 10, marginTop: 8 },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 18 },
  modalCancel: { flex: 1, backgroundColor: "#1a1a1a", borderRadius: 14, padding: 15, alignItems: "center" },
  modalCancelText: { color: "#888", fontWeight: "700" },
  modalConfirm: { flex: 1, backgroundColor: "#06b6d4", borderRadius: 14, padding: 15, alignItems: "center" },
  modalConfirmOff: { backgroundColor: "#1a1a1a" },
  modalConfirmText: { color: "#000", fontWeight: "900" },

  // Owner badge
  ownerBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(6,182,212,0.08)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: "rgba(6,182,212,0.2)" },
  ownerBadgeText: { color: "#06b6d4", fontSize: 10, fontWeight: "800" },

  // Announcement section in card
  announcementBox: { backgroundColor: "rgba(6,182,212,0.05)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(6,182,212,0.15)", padding: 12, marginBottom: 12 },
  announcementHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  announcementLabel: { color: "#06b6d4", fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  announcementText: { color: "#ccc", fontSize: 13, lineHeight: 19 },

  // Manage button
  manageBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(6,182,212,0.08)", borderRadius: 13, paddingVertical: 12, borderWidth: 1, borderColor: "rgba(6,182,212,0.2)" },
  manageBtnText: { color: "#06b6d4", fontWeight: "800", fontSize: 14 },

  // Management modal
  manageSubLabel: { color: "#444", fontSize: 12, marginBottom: 10, marginTop: 2, lineHeight: 17 },
  charCounter: { color: "#333", fontSize: 11, textAlign: "right", marginTop: 5, marginBottom: 4 },

  // Join request rows
  joinReqRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#0d0d0d", borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#1a1a1a" },
  joinReqAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center" },
  joinReqAvatarText: { color: "#555", fontSize: 15, fontWeight: "800" },
  joinReqName: { flex: 1, color: "#fff", fontSize: 14, fontWeight: "700" },
  joinReqActions: { flexDirection: "row", gap: 8 },
  joinAcceptBtn: { backgroundColor: "rgba(34,197,94,0.12)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: "rgba(34,197,94,0.25)" },
  joinAcceptText: { color: "#22c55e", fontSize: 12, fontWeight: "800" },
  joinDenyBtn: { backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },
  joinDenyText: { color: "#ef4444", fontSize: 12, fontWeight: "800" },
  noRequestsRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#0a0a0a", borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "#1a1a1a", marginBottom: 4 },
  noRequestsText: { color: "#333", fontSize: 13, fontWeight: "600" },

  // Danger zone
  dangerZone: { marginTop: 28, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1e1e1e", paddingTop: 20 },
  dangerZoneLabel: { color: "#333", fontSize: 10, fontWeight: "900", letterSpacing: 1.4, marginBottom: 12 },
  cancelTournBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "rgba(239,68,68,0.06)", borderRadius: 13, paddingVertical: 13, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },
  cancelTournText: { color: "#ef4444", fontWeight: "800", fontSize: 14 },

  // Cancel confirmation modal
  confirmBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 24 },
  confirmCard: { backgroundColor: "#111", borderRadius: 24, padding: 28, width: "100%", maxWidth: 360, borderWidth: 1, borderColor: "#1e1e1e", alignItems: "center" },
  confirmIconWrap: { width: 60, height: 60, borderRadius: 30, backgroundColor: "rgba(239,68,68,0.08)", alignItems: "center", justifyContent: "center", marginBottom: 16, borderWidth: 1, borderColor: "rgba(239,68,68,0.15)" },
  confirmTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 10 },
  confirmBody: { color: "#555", fontSize: 14, textAlign: "center", lineHeight: 21, marginBottom: 24 },
  confirmBtns: { flexDirection: "row", gap: 10, width: "100%" },
  confirmKeep: { flex: 1, backgroundColor: "#1a1a1a", borderRadius: 14, padding: 14, alignItems: "center" },
  confirmKeepText: { color: "#888", fontWeight: "700", fontSize: 14 },
  confirmDelete: { flex: 1, backgroundColor: "rgba(239,68,68,0.12)", borderRadius: 14, padding: 14, alignItems: "center", borderWidth: 1, borderColor: "rgba(239,68,68,0.3)" },
  confirmDeleteText: { color: "#ef4444", fontWeight: "900", fontSize: 14 },

  // FF card — live bracket & results buttons
  ffViewBracketBtn: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, backgroundColor: "rgba(168,85,247,0.08)", borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: "rgba(168,85,247,0.2)" },
  ffViewBracketText: { flex: 1, color: "#a855f7", fontSize: 13, fontWeight: "800" },
  ffLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ef4444" },
  ffResultsViewBtn: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "#0d0d0d", borderRadius: 8, borderWidth: 1, borderColor: "#1e1e1e", marginTop: 6 },
  ffResultsViewBtnText: { color: "#555", fontSize: 11, fontWeight: "700" },

  // Bracket viewer modal
  bvHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16 },
  bvTitle: { color: "#fff", fontSize: 20, fontWeight: "900" },
  bvLiveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#ef4444" },
  bvRoundTabs: { flexDirection: "row", paddingHorizontal: 16, gap: 6, paddingBottom: 4 },
  bvRoundTab: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: "#0f0f0f", borderWidth: 1, borderColor: "#1a1a1a" },
  bvRoundTabActive: { backgroundColor: "rgba(168,85,247,0.12)", borderColor: "rgba(168,85,247,0.3)" },
  bvRoundTabText: { color: "#444", fontSize: 11, fontWeight: "700" },
  bvRoundDot: { width: 6, height: 6, borderRadius: 3 },
  bvWinnersCard: { backgroundColor: "rgba(168,85,247,0.08)", borderRadius: 16, borderWidth: 1, borderColor: "rgba(168,85,247,0.2)", padding: 18, marginBottom: 20 },
  bvWinnersTitle: { color: "#fff", fontSize: 18, fontWeight: "900", textAlign: "center", marginBottom: 14 },
  bvWinnerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(168,85,247,0.1)" },
  bvWinnerMedal: { fontSize: 24, width: 36, textAlign: "center" },
  bvWinnerName: { color: "#fff", fontSize: 15, fontWeight: "700", flex: 1 },
  bvGroupCard: { backgroundColor: "#0d0d0d", borderRadius: 16, borderWidth: 1, borderColor: "#1a1a1a", marginBottom: 12, overflow: "hidden" },
  bvGroupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#111", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e1e1e" },
  bvGroupTitle: { color: "#fff", fontSize: 13, fontWeight: "800" },
  bvGroupBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  bvSlotRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#141414" },
  bvSlotName: { flex: 1, color: "#ccc", fontSize: 13, fontWeight: "600" },
  bvSlotRank: { color: "#a855f7", fontSize: 11, fontWeight: "800" },
  bvSlotElim: { color: "#333", fontSize: 10, fontWeight: "700" },
  bvGameResult: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "rgba(0,0,0,0.2)", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#141414" },
  bvGameResultLabel: { color: "#a855f7", fontSize: 10, fontWeight: "800", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.6 },
  bvGameScore: { color: "#666", fontSize: 12, marginVertical: 1 },
});
