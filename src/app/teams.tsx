import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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

type Team = {
  id: string; name: string; captain_user_id: string;
  photo_url: string | null;
  member_count: number; wins: number; losses: number;
  isMember: boolean; isCaptain: boolean;
  myRequestStatus: "pending" | "invited" | null;
  pendingRequestCount: number;
};

type UserResult = { id: string; username: string };
type JoinRequest = {
  id: string; user_id: string; username: string;
  direction: string; created_at: string; message: string | null;
};

export default function TeamsScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState("");

  // Create team modal
  const [createVisible, setCreateVisible] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Join request modal (with message)
  const [requestJoinTeam, setRequestJoinTeam] = useState<{ id: string; name: string } | null>(null);
  const [requestMessage, setRequestMessage] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  // Leave confirm inline
  const [leaveTarget, setLeaveTarget] = useState<Team | null>(null);
  const [leaving, setLeaving] = useState(false);

  // Invite modal (captain)
  const [inviteTeamId, setInviteTeamId] = useState<string | null>(null);
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteResults, setInviteResults] = useState<UserResult[]>([]);
  const [inviteSearching, setInviteSearching] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSentTo, setInviteSentTo] = useState<string | null>(null);

  // Requests modal (captain)
  const [requestsTeam, setRequestsTeam] = useState<Team | null>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);

  async function loadTeams() {
    if (!user) return;

    const [teamsRes, membersRes, myRes, requestsRes] = await Promise.all([
      supabase.from("teams").select("id, name, captain_user_id, photo_url").order("name"),
      supabase.from("team_members").select("team_id, user_id"),
      supabase.from("team_members").select("team_id").eq("user_id", user.id),
      supabase.from("team_requests").select("team_id, user_id, direction, status").or(`user_id.eq.${user.id},team_id.in.(select id from teams where captain_user_id='${user.id}')`),
    ]);

    const myIds = new Set((myRes.data ?? []).map((m) => m.team_id));
    const byTeam: Record<string, string[]> = {};
    for (const m of membersRes.data ?? []) {
      if (!byTeam[m.team_id]) byTeam[m.team_id] = [];
      byTeam[m.team_id].push(m.user_id);
    }

    const myRequests: Record<string, "pending" | "invited"> = {};
    const pendingByTeam: Record<string, number> = {};
    for (const r of requestsRes.data ?? []) {
      if (r.user_id === user.id && r.status === "pending") {
        myRequests[r.team_id] = r.direction === "invite" ? "invited" : "pending";
      }
      if (r.status === "pending") {
        pendingByTeam[r.team_id] = (pendingByTeam[r.team_id] ?? 0) + 1;
      }
    }

    const enriched: Team[] = (teamsRes.data ?? []).map((t) => ({
      id: t.id, name: t.name, captain_user_id: t.captain_user_id,
      photo_url: (t as any).photo_url ?? null,
      member_count: byTeam[t.id]?.length ?? 0,
      wins: 0, losses: 0,
      isMember: myIds.has(t.id),
      isCaptain: t.captain_user_id === user.id,
      myRequestStatus: myRequests[t.id] ?? null,
      pendingRequestCount: pendingByTeam[t.id] ?? 0,
    }));

    const leagueRes = await supabase.from("league_teams").select("team_id, wins, losses");
    if (leagueRes.data) {
      const rec: Record<string, { wins: number; losses: number }> = {};
      for (const lt of leagueRes.data) {
        if (!rec[lt.team_id]) rec[lt.team_id] = { wins: 0, losses: 0 };
        rec[lt.team_id].wins += lt.wins;
        rec[lt.team_id].losses += lt.losses;
      }
      enriched.forEach((t) => { if (rec[t.id]) { t.wins = rec[t.id].wins; t.losses = rec[t.id].losses; } });
    }

    setTeams(enriched);
    setLoading(false);
    setRefreshing(false);
  }

  async function handleRequestJoin() {
    if (!user || !requestJoinTeam) return;
    setRequestError(null);
    setSubmittingRequest(true);
    const { error } = await supabase.from("team_requests").insert({
      team_id: requestJoinTeam.id,
      user_id: user.id,
      direction: "request",
      status: "pending",
      message: requestMessage.trim() || null,
    });
    setSubmittingRequest(false);
    if (error) {
      setRequestError(error.message);
    } else {
      setRequestJoinTeam(null);
      setRequestMessage("");
      await loadTeams();
    }
  }

  async function handleCancelRequest(teamId: string) {
    if (!user) return;
    await supabase.from("team_requests").delete().eq("team_id", teamId).eq("user_id", user.id);
    await loadTeams();
  }

  async function handleAcceptInvite(teamId: string) {
    if (!user) return;
    await supabase.from("team_requests").update({ status: "approved" }).eq("team_id", teamId).eq("user_id", user.id);
    await supabase.from("team_members").insert({ team_id: teamId, user_id: user.id, role: "member" });
    await loadTeams();
  }

  async function confirmLeave() {
    if (!user || !leaveTarget) return;
    setLeaving(true);
    await supabase.from("team_members").delete().eq("team_id", leaveTarget.id).eq("user_id", user.id);
    setLeaving(false);
    setLeaveTarget(null);
    await loadTeams();
  }

  async function handleCreateTeam() {
    if (!user || !newTeamName.trim()) return;
    const name = newTeamName.trim();
    setCreateError(null);
    setCreating(true);
    const { data: team, error } = await supabase
      .from("teams")
      .insert({ name, captain_user_id: user.id })
      .select("id")
      .single();
    if (error || !team) {
      setCreateError(error?.message ?? "Could not create team. Check Supabase RLS policies.");
      setCreating(false);
      return;
    }
    await supabase.from("team_members").insert({ team_id: team.id, user_id: user.id, role: "captain" });
    setCreating(false);
    setCreateVisible(false);
    setNewTeamName("");
    router.push({ pathname: "/team-detail" as any, params: { teamId: team.id, teamName: name } });
    loadTeams();
  }

  async function searchInviteUsers(text: string) {
    if (!text.trim() || !user) { setInviteResults([]); return; }
    setInviteSearching(true);
    const { data } = await supabase.from("profiles").select("id, username").ilike("username", `%${text.trim()}%`).neq("id", user.id).limit(8);
    setInviteResults(data ?? []);
    setInviteSearching(false);
  }

  async function handleInviteUser(inviteeId: string, username: string) {
    if (!inviteTeamId || !user) return;
    setInviteError(null);
    setInviting(true);
    const { error } = await supabase.from("team_requests").upsert(
      {
        team_id: inviteTeamId,
        user_id: inviteeId,
        direction: "invite",
        status: "pending",
        message: inviteMessage.trim() || null,
      },
      { onConflict: "team_id,user_id" }
    );
    setInviting(false);
    if (error) {
      setInviteError(error.message);
    } else {
      setInviteSentTo(username);
      setInviteSearch("");
      setInviteMessage("");
      setInviteResults([]);
    }
  }

  async function loadRequests(team: Team) {
    setRequestsTeam(team);
    setRequestsLoading(true);
    const { data } = await supabase
      .from("team_requests")
      .select("id, user_id, direction, status, created_at, message, profiles(username)")
      .eq("team_id", team.id)
      .eq("status", "pending");
    const mapped: JoinRequest[] = (data ?? []).map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      username: Array.isArray(r.profiles) ? r.profiles[0]?.username : r.profiles?.username ?? "Unknown",
      direction: r.direction,
      created_at: r.created_at,
      message: r.message ?? null,
    }));
    setRequests(mapped);
    setRequestsLoading(false);
  }

  async function approveRequest(requestId: string, userId: string) {
    if (!requestsTeam) return;
    await supabase.from("team_requests").update({ status: "approved" }).eq("id", requestId);
    await supabase.from("team_members").insert({ team_id: requestsTeam.id, user_id: userId, role: "member" });
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
    await loadTeams();
  }

  async function denyRequest(requestId: string) {
    await supabase.from("team_requests").update({ status: "denied" }).eq("id", requestId);
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
  }

  useEffect(() => { if (user) loadTeams(); }, [user]);
  useFocusEffect(useCallback(() => { if (user) loadTeams(); }, [user]));

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  const searchLower = searchText.toLowerCase().trim();
  const myTeams = teams.filter((t) => t.isMember && (!searchLower || t.name.toLowerCase().includes(searchLower)));
  const invitedTeams = teams.filter((t) => !t.isMember && t.myRequestStatus === "invited");
  const otherTeams = teams.filter((t) => !t.isMember && t.myRequestStatus !== "invited" && (!searchLower || t.name.toLowerCase().includes(searchLower)));

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadTeams(); }} tintColor="#06b6d4" />}
        >
          <View style={styles.content}>
            {/* Header */}
            <View style={styles.pageHeader}>
              <View>
                <Text style={styles.pageTitle}>Teams</Text>
                <Text style={styles.pageSub}>Skee-ball crews</Text>
              </View>
              <View style={styles.headerBtns}>
                <Pressable style={styles.leaguesBtn} onPress={() => router.push("/leagues")}>
                  <Ionicons name="trophy-outline" size={14} color="#f59e0b" />
                  <Text style={styles.leaguesBtnText}>Leagues</Text>
                </Pressable>
                <Pressable style={styles.newBtn} onPress={() => { setCreateError(null); setCreateVisible(true); }}>
                  <Ionicons name="add" size={16} color="#000" />
                  <Text style={styles.newBtnText}>New</Text>
                </Pressable>
              </View>
            </View>

            {/* Search bar */}
            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={16} color="#444" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search teams by name…"
                placeholderTextColor="#333"
                autoCapitalize="none"
                value={searchText}
                onChangeText={setSearchText}
                returnKeyType="search"
              />
              {searchText.length > 0 && (
                <Pressable onPress={() => setSearchText("")}>
                  <Ionicons name="close-circle" size={16} color="#444" />
                </Pressable>
              )}
            </View>

            {/* Invites (never filtered by search) */}
            {invitedTeams.length > 0 && (
              <>
                <SectionLabel text="Team Invites" />
                {invitedTeams.map((t) => (
                  <View key={t.id} style={[styles.teamCard, styles.teamCardInvite]}>
                    {t.photo_url
                      ? <Image source={{ uri: t.photo_url }} style={[styles.teamAvatar, { overflow: "hidden" }]} contentFit="cover" cachePolicy="none" />
                      : <View style={styles.teamAvatar}><Text style={styles.teamAvatarText}>{t.name.slice(0, 2).toUpperCase()}</Text></View>
                    }
                    <View style={styles.teamInfo}>
                      <Text style={styles.teamName}>{t.name}</Text>
                      <Text style={styles.teamMeta}>{t.member_count} members · Invited you</Text>
                    </View>
                    <View style={styles.inviteActions}>
                      <Pressable style={styles.acceptBtn} onPress={() => handleAcceptInvite(t.id)}>
                        <Text style={styles.acceptBtnText}>Accept</Text>
                      </Pressable>
                      <Pressable style={styles.declineBtn} onPress={() => handleCancelRequest(t.id)}>
                        <Text style={styles.declineBtnText}>Decline</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* My teams */}
            {myTeams.length > 0 && (
              <>
                <SectionLabel text="Your Teams" />
                {myTeams.map((t) => (
                  <Pressable
                    key={t.id}
                    style={[styles.teamCard, styles.teamCardMine]}
                    onPress={() => router.push({ pathname: "/team-detail" as any, params: { teamId: t.id, teamName: t.name } })}
                  >
                    {t.photo_url
                      ? <Image source={{ uri: t.photo_url }} style={[styles.teamAvatar, { overflow: "hidden" }]} contentFit="cover" cachePolicy="none" />
                      : <View style={styles.teamAvatar}><Text style={styles.teamAvatarText}>{t.name.slice(0, 2).toUpperCase()}</Text></View>
                    }
                    <View style={styles.teamInfo}>
                      <View style={styles.teamNameRow}>
                        <Text style={styles.teamName}>{t.name}</Text>
                        {t.isCaptain && <View style={styles.captainTag}><Text style={styles.captainTagText}>Captain</Text></View>}
                      </View>
                      <Text style={styles.teamMeta}>
                        {t.member_count} {t.member_count === 1 ? "member" : "members"}
                        {(t.wins > 0 || t.losses > 0) ? `  ·  ${t.wins}–${t.losses}` : ""}
                      </Text>
                    </View>
                    <View style={styles.memberActions}>
                      {t.isCaptain && (
                        <>
                          {t.pendingRequestCount > 0 && (
                            <Pressable style={styles.requestsBadgeBtn} onPress={(e) => { e.stopPropagation(); loadRequests(t); }}>
                              <Text style={styles.requestsBadgeText}>{t.pendingRequestCount}</Text>
                            </Pressable>
                          )}
                          <Pressable style={styles.inviteIconBtn} onPress={(e) => { e.stopPropagation(); setInviteError(null); setInviteSentTo(null); setInviteTeamId(t.id); }}>
                            <Ionicons name="person-add-outline" size={18} color="#06b6d4" />
                          </Pressable>
                        </>
                      )}
                      <Pressable style={styles.leaveBtn} onPress={(e) => { e.stopPropagation(); setLeaveTarget(t); }}>
                        <Text style={styles.leaveBtnText}>Leave</Text>
                      </Pressable>
                      <Ionicons name="chevron-forward" size={14} color="#333" />
                    </View>
                  </Pressable>
                ))}
              </>
            )}

            {/* Other teams */}
            <SectionLabel text={myTeams.length > 0 ? "Other Teams" : "All Teams"} />
            {otherTeams.length === 0 && myTeams.length === 0 && invitedTeams.length === 0 && (
              searchText ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="search-outline" size={40} color="#333" style={{ marginBottom: 12 }} />
                  <Text style={styles.emptyTitle}>No teams found</Text>
                  <Text style={styles.emptySub}>Try a different name</Text>
                </View>
              ) : (
                <View style={styles.emptyCard}>
                  <Ionicons name="people-outline" size={40} color="#333" style={{ marginBottom: 12 }} />
                  <Text style={styles.emptyTitle}>No teams yet</Text>
                  <Text style={styles.emptySub}>Create the first one!</Text>
                </View>
              )
            )}
            {otherTeams.length === 0 && myTeams.length > 0 && !searchText && (
              <Text style={styles.allJoined}>You've joined all existing teams.</Text>
            )}
            {otherTeams.map((t) => (
              <View key={t.id} style={styles.teamCard}>
                {t.photo_url
                  ? <Image source={{ uri: t.photo_url }} style={[styles.teamAvatar, { overflow: "hidden" }]} contentFit="cover" cachePolicy="none" />
                  : <View style={styles.teamAvatar}><Text style={styles.teamAvatarText}>{t.name.slice(0, 2).toUpperCase()}</Text></View>
                }
                <View style={styles.teamInfo}>
                  <Text style={styles.teamName}>{t.name}</Text>
                  <Text style={styles.teamMeta}>
                    {t.member_count} {t.member_count === 1 ? "member" : "members"}
                    {(t.wins > 0 || t.losses > 0) ? `  ·  ${t.wins}–${t.losses}` : ""}
                  </Text>
                </View>
                {t.myRequestStatus === "pending" ? (
                  <Pressable style={styles.pendingBtn} onPress={() => handleCancelRequest(t.id)}>
                    <Text style={styles.pendingBtnText}>Pending</Text>
                  </Pressable>
                ) : (
                  <Pressable style={styles.requestBtn} onPress={() => { setRequestError(null); setRequestMessage(""); setRequestJoinTeam({ id: t.id, name: t.name }); }}>
                    <Text style={styles.requestBtnText}>Request</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
      <BottomTabBar />

      {/* ── Create team modal ───────────────────────────────────── */}
      <Modal visible={createVisible} transparent animationType="slide" onRequestClose={() => setCreateVisible(false)}>
        <View style={styles.modalBg}>
          <Pressable style={styles.modalDismiss} onPress={() => setCreateVisible(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Create Team</Text>
            <Text style={styles.modalSub}>Choose a name for your crew</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Team name"
              placeholderTextColor="#333"
              value={newTeamName}
              onChangeText={setNewTeamName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreateTeam}
            />
            {createError && (
              <View style={styles.inlineError}>
                <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
                <Text style={styles.inlineErrorText}>{createError}</Text>
              </View>
            )}
            <View style={styles.modalBtns}>
              <Pressable style={styles.modalCancel} onPress={() => { setCreateVisible(false); setNewTeamName(""); setCreateError(null); }}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalConfirm, (!newTeamName.trim() || creating) && styles.modalConfirmOff]} onPress={handleCreateTeam} disabled={creating || !newTeamName.trim()}>
                <Text style={styles.modalConfirmText}>{creating ? "Creating…" : "Create"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Join request modal ──────────────────────────────────── */}
      <Modal visible={!!requestJoinTeam} transparent animationType="slide" onRequestClose={() => setRequestJoinTeam(null)}>
        <View style={styles.modalBg}>
          <Pressable style={styles.modalDismiss} onPress={() => setRequestJoinTeam(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.inviteModalTop}>
              <View>
                <Text style={styles.modalTitle}>Request to Join</Text>
                <Text style={styles.modalSub}>{requestJoinTeam?.name}</Text>
              </View>
              <Pressable onPress={() => setRequestJoinTeam(null)}>
                <Ionicons name="close" size={22} color="#555" />
              </Pressable>
            </View>
            <Text style={styles.fieldLabel}>Why do you want to join? (optional)</Text>
            <TextInput
              style={[styles.modalInput, styles.messageInput]}
              placeholder="Tell the captain about yourself…"
              placeholderTextColor="#333"
              value={requestMessage}
              onChangeText={setRequestMessage}
              multiline
              numberOfLines={3}
              maxLength={200}
            />
            <Text style={styles.charCount}>{requestMessage.length}/200</Text>
            {requestError && (
              <View style={styles.inlineError}>
                <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
                <Text style={styles.inlineErrorText}>{requestError}</Text>
              </View>
            )}
            <View style={styles.modalBtns}>
              <Pressable style={styles.modalCancel} onPress={() => setRequestJoinTeam(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalConfirm, submittingRequest && styles.modalConfirmOff]} onPress={handleRequestJoin} disabled={submittingRequest}>
                <Text style={styles.modalConfirmText}>{submittingRequest ? "Sending…" : "Send Request"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Leave confirm modal ─────────────────────────────────── */}
      <Modal visible={!!leaveTarget} transparent animationType="fade" onRequestClose={() => setLeaveTarget(null)}>
        <View style={styles.modalBg}>
          <Pressable style={styles.modalDismiss} onPress={() => setLeaveTarget(null)} />
          <View style={[styles.modalSheet, styles.confirmSheet]}>
            <View style={styles.modalHandle} />
            <Ionicons name="log-out-outline" size={32} color="#ef4444" style={{ alignSelf: "center", marginBottom: 12 }} />
            <Text style={styles.modalTitle}>Leave {leaveTarget?.name}?</Text>
            <Text style={styles.modalSub}>You'll need to request to join again.</Text>
            <View style={styles.modalBtns}>
              <Pressable style={styles.modalCancel} onPress={() => setLeaveTarget(null)}>
                <Text style={styles.modalCancelText}>Stay</Text>
              </Pressable>
              <Pressable style={[styles.leaveConfirmBtn, leaving && { opacity: 0.5 }]} onPress={confirmLeave} disabled={leaving}>
                <Text style={styles.leaveConfirmText}>{leaving ? "Leaving…" : "Leave Team"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Invite modal ────────────────────────────────────────── */}
      <Modal visible={!!inviteTeamId} transparent animationType="slide" onRequestClose={() => { setInviteTeamId(null); setInviteSentTo(null); }}>
        <View style={styles.modalBg}>
          <Pressable style={styles.modalDismiss} onPress={() => { setInviteTeamId(null); setInviteSentTo(null); }} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.inviteModalTop}>
              <Text style={styles.modalTitle}>Invite Player</Text>
              <Pressable onPress={() => { setInviteTeamId(null); setInviteSearch(""); setInviteResults([]); setInviteMessage(""); setInviteSentTo(null); }}>
                <Ionicons name="close" size={22} color="#555" />
              </Pressable>
            </View>

            {inviteSentTo ? (
              <View style={styles.inviteSentBox}>
                <Ionicons name="checkmark-circle" size={28} color="#22c55e" />
                <Text style={styles.inviteSentText}>Invite sent to {inviteSentTo}!</Text>
                <Pressable style={styles.inviteAnotherBtn} onPress={() => setInviteSentTo(null)}>
                  <Text style={styles.inviteAnotherText}>Invite another</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={styles.searchWrap}>
                  <Ionicons name="search-outline" size={16} color="#444" />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search by username…"
                    placeholderTextColor="#333"
                    autoFocus
                    autoCapitalize="none"
                    value={inviteSearch}
                    onChangeText={(t) => { setInviteSearch(t); searchInviteUsers(t); }}
                  />
                  {inviteSearching && <ActivityIndicator size="small" color="#06b6d4" />}
                </View>

                <Text style={styles.fieldLabel}>Include a message (optional)</Text>
                <TextInput
                  style={[styles.modalInput, styles.messageInput]}
                  placeholder="Why you should join us…"
                  placeholderTextColor="#333"
                  value={inviteMessage}
                  onChangeText={setInviteMessage}
                  multiline
                  numberOfLines={2}
                  maxLength={200}
                />
                <Text style={styles.charCount}>{inviteMessage.length}/200</Text>

                {inviteError && (
                  <View style={styles.inlineError}>
                    <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
                    <Text style={styles.inlineErrorText}>{inviteError}</Text>
                  </View>
                )}

                <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled">
                  {inviteResults.map((u) => (
                    <Pressable key={u.id} style={styles.resultRow} onPress={() => handleInviteUser(u.id, u.username)} disabled={inviting}>
                      <View style={styles.resultAvatar}>
                        <Text style={styles.resultAvatarText}>{u.username[0].toUpperCase()}</Text>
                      </View>
                      <Text style={styles.resultUsername}>{u.username}</Text>
                      <View style={styles.sendBtn}>
                        {inviting
                          ? <ActivityIndicator size="small" color="#000" />
                          : <><Ionicons name="paper-plane-outline" size={14} color="#000" /><Text style={styles.sendBtnText}>Invite</Text></>
                        }
                      </View>
                    </Pressable>
                  ))}
                  {inviteSearch.trim().length > 0 && inviteResults.length === 0 && !inviteSearching && (
                    <Text style={styles.noResults}>No users found</Text>
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Join requests modal (captain) ───────────────────────── */}
      <Modal visible={!!requestsTeam} transparent animationType="slide" onRequestClose={() => setRequestsTeam(null)}>
        <View style={styles.modalBg}>
          <Pressable style={styles.modalDismiss} onPress={() => setRequestsTeam(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.inviteModalTop}>
              <Text style={styles.modalTitle}>Join Requests</Text>
              <Pressable onPress={() => setRequestsTeam(null)}>
                <Ionicons name="close" size={22} color="#555" />
              </Pressable>
            </View>
            {requestsLoading ? (
              <ActivityIndicator color="#06b6d4" style={{ marginTop: 20 }} />
            ) : requests.length === 0 ? (
              <View style={styles.noRequestsWrap}>
                <Ionicons name="checkmark-done-circle-outline" size={40} color="#2a2a2a" />
                <Text style={styles.noResults}>No pending requests</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 480 }}>
                {requests.map((r) => (
                  <View key={r.id} style={styles.requestRow}>
                    <View style={styles.resultAvatar}>
                      <Text style={styles.resultAvatarText}>{r.username[0].toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultUsername}>{r.username}</Text>
                      <Text style={styles.requestDirection}>{r.direction === "invite" ? "Invited by you" : "Requested to join"}</Text>
                      {r.message ? (
                        <View style={styles.messageBubble}>
                          <Text style={styles.messageBubbleText}>{r.message}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.requestBtnRow}>
                      <Pressable style={styles.approveBtn} onPress={() => approveRequest(r.id, r.user_id)}>
                        <Ionicons name="checkmark" size={16} color="#000" />
                      </Pressable>
                      <Pressable style={styles.denyBtn} onPress={() => denyRequest(r.id)}>
                        <Ionicons name="close" size={16} color="#ef4444" />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  safe: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },

  pageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 },
  pageTitle: { color: "#fff", fontSize: 32, fontWeight: "900", letterSpacing: -0.5, marginBottom: 2 },
  pageSub: { color: "#555", fontSize: 14 },
  headerBtns: { flexDirection: "row", gap: 8 },
  leaguesBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(245,158,11,0.1)", borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: "rgba(245,158,11,0.2)",
  },
  leaguesBtnText: { color: "#f59e0b", fontWeight: "700", fontSize: 13 },
  newBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#06b6d4", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
  },
  newBtnText: { color: "#000", fontWeight: "800", fontSize: 14 },

  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#0d0d0d", borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: "#1e1e1e",
    marginBottom: 20,
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 15 },

  sectionLabel: { color: "#444", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 12 },

  emptyCard: { backgroundColor: "#0d0d0d", borderRadius: 20, padding: 40, alignItems: "center", borderWidth: 1, borderColor: "#1a1a1a" },
  emptyTitle: { color: "#fff", fontSize: 17, fontWeight: "800", marginBottom: 6 },
  emptySub: { color: "#555", fontSize: 14 },
  allJoined: { color: "#444", fontSize: 14, textAlign: "center", paddingVertical: 20 },

  teamCard: { backgroundColor: "#111", borderRadius: 18, padding: 16, flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 10, borderWidth: 1, borderColor: "#1e1e1e" },
  teamCardMine: { borderColor: "rgba(6,182,212,0.25)" },
  teamCardInvite: { borderColor: "rgba(245,158,11,0.3)" },
  teamAvatar: { width: 44, height: 44, borderRadius: 13, backgroundColor: "rgba(6,182,212,0.1)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(6,182,212,0.2)" },
  teamAvatarText: { color: "#06b6d4", fontSize: 14, fontWeight: "900" },
  teamInfo: { flex: 1 },
  teamNameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  teamName: { color: "#fff", fontSize: 15, fontWeight: "800" },
  teamMeta: { color: "#555", fontSize: 13 },
  captainTag: { backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  captainTagText: { color: "#f59e0b", fontSize: 10, fontWeight: "800" },

  memberActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  requestsBadgeBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center" },
  requestsBadgeText: { color: "#fff", fontSize: 11, fontWeight: "900" },
  inviteIconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(6,182,212,0.1)", alignItems: "center", justifyContent: "center" },
  leaveBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: "#2a1515" },
  leaveBtnText: { color: "#ef4444", fontWeight: "800", fontSize: 13 },

  requestBtn: { backgroundColor: "#1a1a1a", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: "#2a2a2a" },
  requestBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  pendingBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: "#2a2a2a" },
  pendingBtnText: { color: "#555", fontWeight: "700", fontSize: 13 },

  inviteActions: { gap: 6 },
  acceptBtn: { backgroundColor: "#06b6d4", borderRadius: 9, paddingHorizontal: 14, paddingVertical: 7 },
  acceptBtnText: { color: "#000", fontWeight: "900", fontSize: 13 },
  declineBtn: { borderRadius: 9, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: "#2a2a2a" },
  declineBtnText: { color: "#555", fontWeight: "700", fontSize: 13 },

  // Modals
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  modalSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: Platform.OS === "ios" ? 36 : 24,
    borderTopWidth: 1, borderColor: "#1e1e1e",
  },
  confirmSheet: { borderRadius: 28, marginHorizontal: 20, marginBottom: 40 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 20 },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "900", marginBottom: 4 },
  modalSub: { color: "#555", fontSize: 14, marginBottom: 18 },
  modalInput: { backgroundColor: "#0a0a0a", color: "#fff", padding: 15, borderRadius: 14, fontSize: 16, borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 6 },
  messageInput: { height: 88, textAlignVertical: "top", paddingTop: 12 },
  charCount: { color: "#333", fontSize: 11, textAlign: "right", marginBottom: 14 },
  fieldLabel: { color: "#444", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 4 },
  modalCancel: { flex: 1, backgroundColor: "#1a1a1a", borderRadius: 14, padding: 15, alignItems: "center" },
  modalCancelText: { color: "#888", fontWeight: "700" },
  modalConfirm: { flex: 1, backgroundColor: "#06b6d4", borderRadius: 14, padding: 15, alignItems: "center" },
  modalConfirmOff: { backgroundColor: "#1a1a1a" },
  modalConfirmText: { color: "#000", fontWeight: "900" },
  leaveConfirmBtn: { flex: 1, backgroundColor: "rgba(239,68,68,0.15)", borderRadius: 14, padding: 15, alignItems: "center", borderWidth: 1, borderColor: "rgba(239,68,68,0.3)" },
  leaveConfirmText: { color: "#ef4444", fontWeight: "900" },

  inlineError: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: "rgba(239,68,68,0.2)" },
  inlineErrorText: { color: "#ef4444", fontSize: 13, flex: 1 },

  inviteModalTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  resultAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#1c1c1c", alignItems: "center", justifyContent: "center" },
  resultAvatarText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  resultUsername: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "700" },
  sendBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#06b6d4", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  sendBtnText: { color: "#000", fontWeight: "800", fontSize: 13 },
  noResults: { color: "#444", textAlign: "center", paddingVertical: 20, fontSize: 14 },
  noRequestsWrap: { alignItems: "center", paddingVertical: 32, gap: 8 },

  inviteSentBox: { alignItems: "center", paddingVertical: 24, gap: 10 },
  inviteSentText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  inviteAnotherBtn: { backgroundColor: "#1a1a1a", borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, marginTop: 4 },
  inviteAnotherText: { color: "#06b6d4", fontWeight: "700", fontSize: 14 },

  requestRow: { flexDirection: "row", alignItems: "flex-start", gap: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  requestDirection: { color: "#555", fontSize: 12, marginTop: 2 },
  messageBubble: { backgroundColor: "#0d0d0d", borderRadius: 10, padding: 10, marginTop: 8, borderWidth: 1, borderColor: "#1e1e1e" },
  messageBubbleText: { color: "#888", fontSize: 13, lineHeight: 18 },
  requestBtnRow: { flexDirection: "row", gap: 8, alignSelf: "center" },
  approveBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center" },
  denyBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: "#2a2a2a", alignItems: "center", justifyContent: "center" },
});
