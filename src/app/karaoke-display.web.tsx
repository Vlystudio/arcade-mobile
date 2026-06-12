import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { createElement, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { supabase } from "../../lib/supabase";

const COUNTDOWN_SECONDS = 15;

type Song = {
  id: string;
  video_id: string;
  title: string;
  channel: string;
  thumbnail_url: string | null;
  requester_name: string;
  status: "queued" | "playing" | "played" | "skipped";
  created_at: string;
};

declare const window: any;

export default function KaraokeDisplayWeb() {
  const playerRef  = useRef<any>(null);
  const currentRef = useRef<Song | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [sessionStarted, setSessionStarted] = useState(false);
  const [playerReady, setPlayerReady]       = useState(false);
  const [nowPlaying, setNowPlaying]         = useState<Song | null>(null);
  const [upcoming, setUpcoming]             = useState<Song[]>([]);
  const [countdown, setCountdown]           = useState<number | null>(null);
  const [queueEmpty, setQueueEmpty]         = useState(false);
  const [isAdmin, setIsAdmin]               = useState(false);
  const [skipping, setSkipping]             = useState(false);

  // ── Supabase realtime ───────────────────────────────────────
  useEffect(() => {
    checkAdmin();
    loadQueue();
    const ch = supabase
      .channel("karaoke-display-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "karaoke_queue" }, loadQueue)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // ── YouTube IFrame API bootstrap ───────────────────────────
  useEffect(() => {
    if (window.YT?.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
      if (!document.getElementById("yt-api-script")) {
        const script  = document.createElement("script");
        script.id     = "yt-api-script";
        script.src    = "https://www.youtube.com/iframe_api";
        document.body.appendChild(script);
      }
    }
  }, []);

  async function checkAdmin() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("profiles").select("role").eq("id", user.id).single();
    if (["admin", "owner", "architect"].includes(data?.role ?? "")) setIsAdmin(true);
  }

  async function loadQueue() {
    const { data } = await supabase
      .from("karaoke_queue")
      .select("id, video_id, title, channel, thumbnail_url, requester_name, status, created_at")
      .in("status", ["playing", "queued"])
      .order("created_at", { ascending: true });
    const items = (data ?? []) as Song[];
    const playing = items.find(i => i.status === "playing") ?? null;
    const queued  = items.filter(i => i.status === "queued");
    setNowPlaying(playing);
    currentRef.current = playing;
    setUpcoming(queued);
    setQueueEmpty(items.length === 0);
  }

  // ── Player init ─────────────────────────────────────────────
  function initPlayer() {
    playerRef.current = new window.YT.Player("yt-player-div", {
      height: "100%",
      width: "100%",
      videoId: "",
      playerVars: {
        autoplay: 0,
        controls: 0,
        rel: 0,
        modestbranding: 1,
        iv_load_policy: 3,
        fs: 0,
      },
      events: {
        onReady: () => setPlayerReady(true),
        onStateChange: handleStateChange,
      },
    });
  }

  function handleStateChange(event: any) {
    // YT.PlayerState.ENDED === 0
    if (event.data === 0) {
      startCountdown();
    }
  }

  // ── Countdown between songs ─────────────────────────────────
  function startCountdown() {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    let c = COUNTDOWN_SECONDS;
    setCountdown(c);
    countdownTimerRef.current = setInterval(() => {
      c -= 1;
      setCountdown(c);
      if (c <= 0) {
        clearInterval(countdownTimerRef.current!);
        countdownTimerRef.current = null;
        setCountdown(null);
        advanceQueue();
      }
    }, 1000);
  }

  // ── Queue advance ───────────────────────────────────────────
  async function advanceQueue() {
    const currentId = currentRef.current?.id ?? null;
    const { data } = await supabase.rpc("rpc_karaoke_next", { p_current_id: currentId });
    const result = data as any;

    if (result?.empty) {
      setQueueEmpty(true);
      setNowPlaying(null);
      currentRef.current = null;
      return;
    }

    if (result?.video_id && playerRef.current) {
      playerRef.current.loadVideoById(result.video_id);
    }
    await loadQueue();
  }

  // ── Start session (first tap unlocks autoplay) ──────────────
  async function handleStartSession() {
    setSessionStarted(true);
    const { data } = await supabase.rpc("rpc_karaoke_next", { p_current_id: null });
    const result = data as any;

    if (result?.empty) { setQueueEmpty(true); return; }

    if (result?.video_id && playerRef.current) {
      playerRef.current.loadVideoById(result.video_id);
      playerRef.current.playVideo();
    }
    await loadQueue();
  }

  // ── Admin skip ──────────────────────────────────────────────
  async function handleSkip() {
    if (!currentRef.current || skipping) return;
    setSkipping(true);
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
      setCountdown(null);
    }
    await supabase.rpc("rpc_karaoke_skip", { p_song_id: currentRef.current.id });
    await advanceQueue();
    setSkipping(false);
  }

  // ── Render ──────────────────────────────────────────────────
  return (
    <View style={s.root}>
      {/* ── Left: Video ───────────────────────────── */}
      <View style={s.playerArea}>
        {/* YouTube player container — IFrame API targets this div by ID */}
        {createElement("div", {
          id: "yt-player-div",
          style: { width: "100%", height: "100%", backgroundColor: "#000" },
        })}

        {/* Overlay: Start Session */}
        {!sessionStarted && (
          <View style={s.overlay}>
            <Ionicons name="mic" size={64} color="#a855f7" style={{ marginBottom: 24 }} />
            <Text style={s.overlayTitle}>Karaoke Night</Text>
            {queueEmpty ? (
              <Text style={s.overlaySub}>No songs in the queue yet. Ask guests to add songs!</Text>
            ) : (
              <>
                <Text style={s.overlaySub}>
                  {upcoming.length + (nowPlaying ? 1 : 0)} song{(upcoming.length + (nowPlaying ? 1 : 0)) !== 1 ? "s" : ""} in the queue
                </Text>
                <Pressable
                  style={[s.startBtn, !playerReady && { opacity: 0.5 }]}
                  onPress={handleStartSession}
                  disabled={!playerReady}
                >
                  {!playerReady
                    ? <ActivityIndicator size="small" color="#000" />
                    : <><Ionicons name="play" size={20} color="#000" /><Text style={s.startBtnText}>Start Session</Text></>
                  }
                </Pressable>
              </>
            )}
          </View>
        )}

        {/* Overlay: Empty queue (session already started) */}
        {sessionStarted && queueEmpty && (
          <View style={s.overlay}>
            <Ionicons name="musical-notes-outline" size={56} color="#2a2a2a" style={{ marginBottom: 20 }} />
            <Text style={s.overlayTitle}>Queue is empty</Text>
            <Text style={s.overlaySub}>Waiting for guests to add songs…</Text>
          </View>
        )}

        {/* Overlay: Countdown between songs */}
        {countdown !== null && (
          <View style={s.countdownOverlay}>
            <Text style={s.countdownNumber}>{countdown}</Text>
            <Text style={s.countdownLabel}>Next song starting soon</Text>
            {upcoming[0] && (
              <View style={s.nextUpCard}>
                <Text style={s.nextUpLabel}>UP NEXT</Text>
                {upcoming[0].thumbnail_url && (
                  <Image source={{ uri: upcoming[0].thumbnail_url }} style={s.nextUpThumb} contentFit="cover" />
                )}
                <Text style={s.nextUpTitle} numberOfLines={2}>{upcoming[0].title}</Text>
                <Text style={s.nextUpBy}>Requested by {upcoming[0].requester_name}</Text>
              </View>
            )}
          </View>
        )}

        {/* Now Playing bar (bottom gradient) */}
        {sessionStarted && nowPlaying && countdown === null && (
          <View style={s.nowBar}>
            <View style={s.nowBarGradient} />
            <View style={s.nowBarContent}>
              <View style={s.nowBadge}>
                <Ionicons name="musical-notes" size={11} color="#000" />
                <Text style={s.nowBadgeText}>NOW PLAYING</Text>
              </View>
              <Text style={s.nowBarTitle} numberOfLines={1}>{nowPlaying.title}</Text>
              <Text style={s.nowBarMeta} numberOfLines={1}>
                {nowPlaying.channel ? `${nowPlaying.channel} · ` : ""}Requested by {nowPlaying.requester_name}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* ── Right: Queue sidebar ───────────────────── */}
      <View style={s.sidebar}>
        <Pressable
          style={s.backBtn}
          onPress={() => router.canGoBack() ? router.back() : router.replace("/karaoke" as any)}
        >
          <Ionicons name="chevron-back" size={16} color="#555" />
          <Text style={s.backBtnText}>Back</Text>
        </Pressable>

        <View style={s.sidebarHeader}>
          <Ionicons name="list" size={16} color="#a855f7" />
          <Text style={s.sidebarTitle}>Up Next</Text>
          {isAdmin && nowPlaying && sessionStarted && (
            <Pressable style={s.skipBtn} onPress={handleSkip} disabled={skipping}>
              {skipping
                ? <ActivityIndicator size="small" color="#ef4444" />
                : <><Ionicons name="play-skip-forward" size={13} color="#ef4444" /><Text style={s.skipBtnText}>Skip</Text></>
              }
            </Pressable>
          )}
        </View>

        {upcoming.length === 0 ? (
          <View style={s.sidebarEmpty}>
            <Text style={s.sidebarEmptyText}>No songs queued</Text>
            <Text style={s.sidebarEmptySub}>Scan the QR or open the app to add songs</Text>
          </View>
        ) : (
          upcoming.slice(0, 8).map((song, idx) => (
            <View key={song.id} style={s.sidebarItem}>
              <Text style={s.sidebarPos}>{idx + 1}</Text>
              {song.thumbnail_url ? (
                <Image source={{ uri: song.thumbnail_url }} style={s.sidebarThumb} contentFit="cover" />
              ) : (
                <View style={[s.sidebarThumb, s.thumbPlaceholder]}>
                  <Ionicons name="musical-note" size={12} color="#333" />
                </View>
              )}
              <View style={s.sidebarInfo}>
                <Text style={s.sidebarSongTitle} numberOfLines={1}>{song.title}</Text>
                <Text style={s.sidebarBy} numberOfLines={1}>By {song.requester_name}</Text>
              </View>
            </View>
          ))
        )}

        {upcoming.length > 8 && (
          <Text style={s.moreText}>+{upcoming.length - 8} more</Text>
        )}

        <View style={s.sidebarFooter}>
          <Ionicons name="mic-outline" size={14} color="#2a2a2a" />
          <Text style={s.sidebarFooterText}>Powered by YouTube · vlystudios.com/karaoke</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    // Escape the 480px centering container on wide web
    position: "fixed" as any,
    top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: "row",
    backgroundColor: "#000",
    zIndex: 100,
  },

  // ── Player area ──────────────────────────────────────────
  playerArea: { flex: 1, position: "relative" as any, backgroundColor: "#000" },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    zIndex: 10,
  },
  overlayTitle: { color: "#fff", fontSize: 36, fontWeight: "900", marginBottom: 12 },
  overlaySub: { color: "#8a8a8a", fontSize: 18, textAlign: "center", marginBottom: 32 },
  startBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#a855f7", borderRadius: 18, paddingVertical: 18, paddingHorizontal: 40 },
  startBtnText: { color: "#000", fontWeight: "900", fontSize: 20 },

  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  countdownNumber: { color: "#a855f7", fontSize: 160, fontWeight: "900", lineHeight: 160 },
  countdownLabel: { color: "#fff", fontSize: 24, fontWeight: "700", marginBottom: 32, marginTop: -8 },
  nextUpCard: { alignItems: "center", gap: 8 },
  nextUpLabel: { color: "#a855f7", fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  nextUpThumb: { width: 120, height: 80, borderRadius: 10 },
  nextUpTitle: { color: "#fff", fontSize: 18, fontWeight: "800", textAlign: "center", maxWidth: 360 },
  nextUpBy: { color: "#666", fontSize: 14 },

  nowBar: { position: "absolute" as any, bottom: 0, left: 0, right: 0, zIndex: 5 },
  nowBarGradient: { position: "absolute" as any, top: -60, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0)" },
  nowBarContent: { backgroundColor: "rgba(0,0,0,0.75)", padding: 20, paddingBottom: 24, gap: 4 },
  nowBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#a855f7", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, alignSelf: "flex-start", marginBottom: 6 },
  nowBadgeText: { color: "#000", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  nowBarTitle: { color: "#fff", fontSize: 22, fontWeight: "900" },
  nowBarMeta: { color: "#888", fontSize: 15 },

  // ── Sidebar ──────────────────────────────────────────────
  sidebar: { width: 280, backgroundColor: "#080808", borderLeftWidth: 1, borderLeftColor: "#111", padding: 20 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 16 },
  backBtnText: { color: "#8a8a8a", fontSize: 13, fontWeight: "600" },
  sidebarHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  sidebarTitle: { color: "#fff", fontSize: 16, fontWeight: "900", flex: 1 },
  skipBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(239,68,68,0.12)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: "rgba(239,68,68,0.25)" },
  skipBtnText: { color: "#ef4444", fontSize: 12, fontWeight: "700" },

  sidebarEmpty: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },
  sidebarEmptyText: { color: "#333", fontSize: 15, fontWeight: "700", marginBottom: 6 },
  sidebarEmptySub: { color: "#2a2a2a", fontSize: 12, textAlign: "center" },

  sidebarItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#111" },
  sidebarPos: { color: "#333", fontSize: 12, fontWeight: "900", minWidth: 18, textAlign: "center" },
  sidebarThumb: { width: 44, height: 32, borderRadius: 6 },
  thumbPlaceholder: { backgroundColor: "#111", alignItems: "center", justifyContent: "center" },
  sidebarInfo: { flex: 1 },
  sidebarSongTitle: { color: "#ccc", fontSize: 13, fontWeight: "700" },
  sidebarBy: { color: "#777", fontSize: 11, marginTop: 2 },

  moreText: { color: "#777", fontSize: 12, textAlign: "center", paddingVertical: 8 },

  sidebarFooter: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: "auto" as any, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#111" },
  sidebarFooterText: { color: "#2a2a2a", fontSize: 11 },
});
