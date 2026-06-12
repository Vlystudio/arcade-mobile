import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";

type Card = {
  username: string; avatar_url: string | null; game_name: string;
  game_type: string; score: number; rank: number; created_at: string;
};

/** Public score card — the target of "Share as Link". No login required. */
export default function ScoreShareScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [card, setCard] = useState<Card | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");

  useEffect(() => {
    if (!id) { setState("missing"); return; }
    supabase.rpc("rpc_public_score_card", { p_score_id: id }).then(({ data }) => {
      if (data && !data.error) { setCard(data as Card); setState("ok"); }
      else setState("missing");
    });
  }, [id]);

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Head>
        <title>{card ? `${card.username} — ${card.score.toLocaleString()} on ${card.game_name}` : "Arcade Score"} · ArcadeTracker</title>
        <meta name="description" content="High score at the arcade — see the leaderboard on ArcadeTracker." />
      </Head>

      <View style={s.wrap}>
        {state === "loading" && <ActivityIndicator size="large" color="#06b6d4" />}

        {state === "missing" && (
          <>
            <Ionicons name="trophy-outline" size={44} color="#333" />
            <Text style={s.missingText}>This score isn't available anymore.</Text>
          </>
        )}

        {state === "ok" && card && (
          <View style={s.card}>
            <Text style={s.rankBadge}>#{card.rank}</Text>
            {card.avatar_url ? (
              <Image source={{ uri: card.avatar_url }} style={s.avatar} contentFit="cover" />
            ) : (
              <View style={[s.avatar, s.avatarFallback]}>
                <Text style={s.avatarInitial}>{card.username[0]?.toUpperCase()}</Text>
              </View>
            )}
            <Text style={s.username}>{card.username}</Text>
            <Text style={s.score}>{card.score.toLocaleString()}</Text>
            <Text style={s.game}>{card.game_name}</Text>
            <Text style={s.date}>
              {new Date(card.created_at).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}
            </Text>
          </View>
        )}

        <Pressable style={s.cta} onPress={() => router.replace("/welcome" as any)}>
          <Ionicons name="game-controller" size={16} color="#000" />
          <Text style={s.ctaText}>Think you can beat it? Join the arcade</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 24 },
  missingText: { color: "#888", fontSize: 15 },

  card: {
    alignItems: "center", backgroundColor: "#0d0d0d", borderRadius: 28,
    paddingVertical: 36, paddingHorizontal: 48, gap: 6,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.3)",
    width: "100%", maxWidth: 380,
  },
  rankBadge: { color: "#f59e0b", fontSize: 22, fontWeight: "900", marginBottom: 6 },
  avatar: { width: 84, height: 84, borderRadius: 42, marginBottom: 10 },
  avatarFallback: { backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: "#000", fontSize: 32, fontWeight: "900" },
  username: { color: "#fff", fontSize: 20, fontWeight: "900" },
  score: { color: "#06b6d4", fontSize: 44, fontWeight: "900", letterSpacing: -1 },
  game: { color: "#aaa", fontSize: 15, fontWeight: "700" },
  date: { color: "#555", fontSize: 12, marginTop: 4 },

  cta: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#06b6d4", borderRadius: 16, paddingHorizontal: 24, paddingVertical: 15,
  },
  ctaText: { color: "#000", fontSize: 14.5, fontWeight: "900" },
});
