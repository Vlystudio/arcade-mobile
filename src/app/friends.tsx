import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../components/avatar";
import { useRequireAuth } from "../hooks/use-require-auth";
import { supabase } from "../../lib/supabase";
import { openUserProfile } from "../lib/open-profile";

type Tab = "friends" | "requests" | "find";

type Friend = {
  friendshipId: string;
  id: string;
  username: string;
  avatar_url: string | null;
  online_status: string;
};

type FriendRequest = {
  friendshipId: string;
  id: string;
  username: string;
  avatar_url: string | null;
};

type SearchUser = {
  id: string;
  username: string;
  avatar_url: string | null;
  friendshipStatus: "none" | "pending_sent" | "pending_received" | "friends";
  friendshipId: string | null;
};

export default function FriendsScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [tab, setTab] = useState<Tab>("friends");

  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);

  const [friendshipMap, setFriendshipMap] = useState<Map<string, { id: string; status: string; role: "requester" | "addressee" }>>(new Map());
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function loadData() {
    if (!user) return;
    setLoadingData(true);

    const { data: all } = await supabase
      .from("friendships")
      .select(`
        id, status, requester_id, addressee_id,
        requester:profiles!requester_id(id, username, avatar_url, online_status),
        addressee:profiles!addressee_id(id, username, avatar_url, online_status)
      `)
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);

    const map = new Map<string, { id: string; status: string; role: "requester" | "addressee" }>();
    const fList: Friend[] = [];
    const rList: FriendRequest[] = [];

    for (const f of all ?? []) {
      const isReq = f.requester_id === user.id;
      const otherProfile = isReq
        ? (Array.isArray(f.addressee) ? f.addressee[0] : f.addressee)
        : (Array.isArray(f.requester) ? f.requester[0] : f.requester);
      const otherId = isReq ? f.addressee_id : f.requester_id;

      map.set(otherId, { id: f.id, status: f.status, role: isReq ? "requester" : "addressee" });

      if (f.status === "accepted") {
        fList.push({
          friendshipId: f.id, id: otherId,
          username: otherProfile?.username ?? "Unknown",
          avatar_url: otherProfile?.avatar_url ?? null,
          online_status: otherProfile?.online_status ?? "offline",
        });
      } else if (f.status === "pending" && !isReq) {
        const req = Array.isArray(f.requester) ? f.requester[0] : f.requester;
        rList.push({
          friendshipId: f.id, id: f.requester_id,
          username: req?.username ?? "Unknown",
          avatar_url: req?.avatar_url ?? null,
        });
      }
    }

    setFriends(fList);
    setRequests(rList);
    setFriendshipMap(map);
    setLoadingData(false);
  }

  async function searchUsers(text: string) {
    if (!text.trim() || !user) { setSearchResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("public_profiles")
      .select("id, username, avatar_url")
      .ilike("username", `%${text.replace(/\s+/g, "")}%`)
      .neq("id", user.id)
      .limit(10);

    const results: SearchUser[] = (data ?? []).map((p: any) => {
      const fs = friendshipMap.get(p.id);
      let status: SearchUser["friendshipStatus"] = "none";
      if (fs) {
        if (fs.status === "accepted") status = "friends";
        else if (fs.status === "pending" && fs.role === "requester") status = "pending_sent";
        else if (fs.status === "pending" && fs.role === "addressee") status = "pending_received";
      }
      return { id: p.id, username: p.username, avatar_url: p.avatar_url, friendshipStatus: status, friendshipId: fs?.id ?? null };
    });

    setSearchResults(results);
    setSearching(false);
  }

  async function sendRequest(userId: string) {
    if (!user || actionLoading) return;
    setActionLoading(userId);
    await supabase.from("friendships").insert({ requester_id: user.id, addressee_id: userId });
    setSearchResults(prev => prev.map(u => u.id === userId ? { ...u, friendshipStatus: "pending_sent" as const } : u));
    await loadData();
    setActionLoading(null);
  }

  async function acceptRequest(friendshipId: string) {
    if (!user || actionLoading) return;
    setActionLoading(friendshipId);
    await supabase.from("friendships").update({ status: "accepted" }).eq("id", friendshipId);
    await loadData();
    setActionLoading(null);
  }

  async function declineRequest(friendshipId: string) {
    if (!user || actionLoading) return;
    setActionLoading(friendshipId);
    await supabase.from("friendships").delete().eq("id", friendshipId);
    await loadData();
    setActionLoading(null);
  }

  async function removeFriend(friendshipId: string) {
    if (!user || actionLoading) return;
    setActionLoading(friendshipId);
    await supabase.from("friendships").delete().eq("id", friendshipId);
    await loadData();
    setActionLoading(null);
  }

  async function openChat(friend: Friend) {
    if (!user) return;
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .or(`and(participant_1.eq.${user.id},participant_2.eq.${friend.id}),and(participant_1.eq.${friend.id},participant_2.eq.${user.id})`)
      .maybeSingle();

    let convId: string;
    if (existing) {
      convId = existing.id;
    } else {
      const { data: created } = await supabase
        .from("conversations")
        .insert({ participant_1: user.id, participant_2: friend.id })
        .select("id").single();
      if (!created) return;
      convId = created.id;
    }
    router.push({ pathname: "/chat-conversation" as any, params: { conversationId: convId, otherUsername: friend.username, otherAvatarUrl: friend.avatar_url ?? "", otherUserId: friend.id } });
  }

  useEffect(() => { if (user) loadData(); }, [user]);

  // Subscribe to incoming friend requests and accepted friendships in real-time
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("friendships_live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "friendships", filter: `addressee_id=eq.${user.id}` },
        () => { loadData(); }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "friendships", filter: `requester_id=eq.${user.id}` },
        () => { loadData(); }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "friendships", filter: `addressee_id=eq.${user.id}` },
        () => { loadData(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  // Subscribe to friends' online status in real-time
  useEffect(() => {
    if (!user || friends.length === 0) return;
    const ids = friends.map(f => f.id).join(",");
    const ch = supabase
      .channel("friends_online")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=in.(${ids})` }, (payload) => {
        const u = payload.new as any;
        setFriends(prev => prev.map(f => f.id === u.id ? { ...f, online_status: u.online_status } : f));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, friends.length]);

  if (authLoading || loadingData) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Friends</Text>
          <View style={{ width: 38 }} />
        </View>

        <View style={styles.tabs}>
          {(["friends", "requests", "find"] as Tab[]).map(t => (
            <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === "friends" ? "Friends"
                  : t === "requests" ? `Requests${requests.length > 0 ? ` (${requests.length})` : ""}`
                  : "Find People"}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Friends ── */}
        {tab === "friends" && (
          <FlatList
            data={friends}
            keyExtractor={f => f.id}
            contentContainerStyle={friends.length === 0 ? styles.emptyWrap : styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="people-outline" size={52} color="#222" />
                <Text style={styles.emptyTitle}>No friends yet</Text>
                <Text style={styles.emptySub}>Find and add players in the Find tab.</Text>
                <Pressable style={styles.emptyBtn} onPress={() => setTab("find")}>
                  <Text style={styles.emptyBtnText}>Find Friends</Text>
                </Pressable>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Pressable style={styles.avatarWrap} onPress={() => openUserProfile(item.id)}>
                  <Pressable onPress={() => openUserProfile(item.id)}>
                  <Avatar uri={item.avatar_url} name={item.username} size={46} />
                </Pressable>
                  <View style={[styles.dot, item.online_status === "online" ? styles.dotOn : styles.dotOff]} />
                </Pressable>
                <View style={styles.info}>
                  <Text style={styles.name}>{item.username}</Text>
                  <Text style={[styles.sub, item.online_status === "online" && { color: "#22c55e" }]}>
                    {item.online_status === "online" ? "Online" : "Offline"}
                  </Text>
                </View>
                <Pressable style={styles.iconBtn} onPress={() => openChat(item)}>
                  <Ionicons name="chatbubble-outline" size={18} color="#06b6d4" />
                </Pressable>
                <Pressable
                  style={[styles.iconBtnGray, actionLoading === item.friendshipId && styles.disabled]}
                  onPress={() => removeFriend(item.friendshipId)}
                  disabled={actionLoading === item.friendshipId}
                >
                  {actionLoading === item.friendshipId
                    ? <ActivityIndicator size="small" color="#555" />
                    : <Ionicons name="person-remove-outline" size={18} color="#555" />}
                </Pressable>
              </View>
            )}
          />
        )}

        {/* ── Requests ── */}
        {tab === "requests" && (
          <FlatList
            data={requests}
            keyExtractor={r => r.id}
            contentContainerStyle={requests.length === 0 ? styles.emptyWrap : styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="mail-outline" size={52} color="#222" />
                <Text style={styles.emptyTitle}>No pending requests</Text>
                <Text style={styles.emptySub}>Friend requests will appear here.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Avatar uri={item.avatar_url} name={item.username} size={46} />
                <View style={styles.info}>
                  <Text style={styles.name}>{item.username}</Text>
                  <Text style={styles.sub}>Wants to be friends</Text>
                </View>
                <View style={styles.reqActions}>
                  <Pressable
                    style={[styles.acceptBtn, !!actionLoading && styles.disabled]}
                    onPress={() => acceptRequest(item.friendshipId)}
                    disabled={!!actionLoading}
                  >
                    {actionLoading === item.friendshipId
                      ? <ActivityIndicator size="small" color="#000" />
                      : <Ionicons name="checkmark" size={20} color="#000" />}
                  </Pressable>
                  <Pressable
                    style={[styles.declineBtn, !!actionLoading && styles.disabled]}
                    onPress={() => declineRequest(item.friendshipId)}
                    disabled={!!actionLoading}
                  >
                    <Ionicons name="close" size={20} color="#555" />
                  </Pressable>
                </View>
              </View>
            )}
          />
        )}

        {/* ── Find ── */}
        {tab === "find" && (
          <View style={styles.findWrap}>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={16} color="#444" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by username…"
                placeholderTextColor="#555"
                autoCapitalize="none"
                value={searchText}
                onChangeText={t => { setSearchText(t); searchUsers(t); }}
              />
              {searching && <ActivityIndicator size="small" color="#06b6d4" />}
            </View>
            <FlatList
              data={searchResults}
              keyExtractor={u => u.id}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                searchText.trim() && !searching
                  ? <Text style={styles.noResults}>No users found</Text>
                  : !searchText.trim()
                  ? <View style={styles.hint}>
                      <Ionicons name="people-outline" size={40} color="#222" />
                      <Text style={styles.hintText}>Search for players to add</Text>
                    </View>
                  : null
              }
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <Pressable onPress={() => openUserProfile(item.id)}>
                    <Avatar uri={item.avatar_url} name={item.username} size={44} />
                  </Pressable>
                  <View style={styles.info}>
                    <Text style={styles.name}>{item.username}</Text>
                    {item.friendshipStatus === "friends" && <Text style={[styles.sub, { color: "#06b6d4" }]}>Friends</Text>}
                    {item.friendshipStatus === "pending_sent" && <Text style={styles.sub}>Request sent</Text>}
                    {item.friendshipStatus === "pending_received" && <Text style={[styles.sub, { color: "#f59e0b" }]}>Sent you a request</Text>}
                  </View>
                  {item.friendshipStatus === "none" && (
                    <Pressable style={[styles.addBtn, actionLoading === item.id && styles.disabled]} onPress={() => sendRequest(item.id)} disabled={!!actionLoading}>
                      {actionLoading === item.id
                        ? <ActivityIndicator size="small" color="#000" />
                        : <><Ionicons name="person-add-outline" size={14} color="#000" /><Text style={styles.addBtnText}>Add</Text></>}
                    </Pressable>
                  )}
                  {item.friendshipStatus === "pending_received" && (
                    <Pressable style={[styles.acceptBtn, !!actionLoading && styles.disabled]} onPress={() => item.friendshipId && acceptRequest(item.friendshipId)} disabled={!!actionLoading}>
                      <Text style={styles.acceptBtnText}>Accept</Text>
                    </Pressable>
                  )}
                </View>
              )}
            />
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  safe: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },

  tabs: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a" },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: "#06b6d4" },
  tabText: { color: "#8a8a8a", fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: "#06b6d4" },

  listContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40 },
  emptyWrap: { flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, paddingTop: 80, gap: 12 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  emptySub: { color: "#8a8a8a", fontSize: 14, textAlign: "center" },
  emptyBtn: { backgroundColor: "#06b6d4", borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnText: { color: "#000", fontWeight: "900", fontSize: 15 },

  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#111",
  },
  avatarWrap: { position: "relative" },
  dot: {
    position: "absolute", bottom: 0, right: 0,
    width: 13, height: 13, borderRadius: 7, borderWidth: 2.5, borderColor: "#000",
  },
  dotOn: { backgroundColor: "#22c55e" },
  dotOff: { backgroundColor: "#3a3a3a" },
  info: { flex: 1 },
  name: { color: "#fff", fontSize: 15, fontWeight: "800" },
  sub:  { color: "#8a8a8a", fontSize: 12, marginTop: 1 },

  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(6,182,212,0.1)", alignItems: "center", justifyContent: "center",
  },
  iconBtnGray: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#0d0d0d", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#1e1e1e",
  },

  reqActions: { flexDirection: "row", gap: 8 },
  acceptBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
  },
  acceptBtnText: { color: "#000", fontWeight: "900", fontSize: 13 },
  declineBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#2a2a2a",
  },
  disabled: { opacity: 0.5 },

  findWrap: { flex: 1, paddingHorizontal: 18, paddingTop: 14 },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#0a0a0a", borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: "#1e1e1e", marginBottom: 12,
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 15 },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#06b6d4", borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  addBtnText: { color: "#000", fontWeight: "800", fontSize: 13 },
  noResults: { color: "#777", textAlign: "center", paddingVertical: 20, fontSize: 14 },
  hint: { alignItems: "center", gap: 10, paddingTop: 60 },
  hintText: { color: "#777", fontSize: 14 },
});
