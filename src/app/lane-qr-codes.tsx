import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import Head from "expo-router/head";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { showToast } from "../components/toast";
import { useRequireAuth } from "../hooks/use-require-auth";

type Lane = { id: string; lane_number: number };
type Generated = { lane_number: number; scanUrl: string; qr: string };

const SITE = process.env.EXPO_PUBLIC_SITE_URL ?? "https://www.vlystudios.com";
const qrUrl = (data: string, size = 600) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=2&data=${encodeURIComponent(data)}`;

export default function LaneQrCodesScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [codes, setCodes] = useState<Generated[]>([]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: prof } = await supabase.from("profiles").select("is_admin, role").eq("id", user.id).single();
      const ok = !!(prof as any)?.is_admin || ["admin", "owner", "architect"].includes((prof as any)?.role);
      setAllowed(ok);
      if (!ok) return;
      const { data } = await supabase
        .from("lanes")
        .select("id, lane_number, games(type)")
        .order("lane_number");
      const skee = (data ?? []).filter((l: any) => {
        const g = Array.isArray(l.games) ? l.games[0] : l.games;
        return g?.type === "skeeball";
      });
      setLanes(skee.map((l: any) => ({ id: l.id, lane_number: l.lane_number })));
    })();
  }, [user]);

  async function generateAll() {
    if (generating || lanes.length === 0) return;
    setGenerating(true);
    const out: Generated[] = [];
    for (const lane of lanes) {
      const { data, error } = await supabase.rpc("rpc_admin_generate_lane_qr_token", {
        p_lane_id: lane.id, p_ttl_hours: null, // null = never expires; only replaced on regenerate
      });
      if (error || data?.error) {
        setGenerating(false);
        showToast(data?.message ?? error?.message ?? `Lane ${lane.lane_number} failed (admin + 2FA required)`, "error");
        return;
      }
      const scanUrl = `${SITE}/scan-lane?lane_token=${data.raw_token}`;
      out.push({ lane_number: lane.lane_number, scanUrl, qr: qrUrl(scanUrl) });
    }
    out.sort((a, b) => a.lane_number - b.lane_number);
    setCodes(out);
    setGenerating(false);
    showToast("Fresh QR codes generated — old codes are now revoked");
  }

  function printCodes() {
    if (Platform.OS !== "web" || codes.length === 0) return;
    const cards = codes.map((c) => `
      <div class="card">
        <div class="lane">LANE ${c.lane_number}</div>
        <img src="${qrUrl(c.scanUrl, 700)}" />
        <div class="cap">Scan to check in your team</div>
        <div class="brand">ArcadeTracker · Skee-Ball League</div>
      </div>`).join("");
    const w = (window as any).open("", "_blank");
    if (!w) { showToast("Allow pop-ups to print", "error"); return; }
    w.document.write(`<!doctype html><html><head><title>Lane QR Codes</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:-apple-system,Segoe UI,sans-serif;background:#fff;color:#111}
  .grid{display:flex;flex-wrap:wrap;justify-content:center;gap:24px;padding:28px}
  .card{width:340px;border:2px solid #111;border-radius:18px;padding:22px;text-align:center;page-break-inside:avoid;break-inside:avoid}
  .lane{font-size:46px;font-weight:900;letter-spacing:1px;margin-bottom:10px}
  .card img{width:280px;height:280px}
  .cap{font-size:16px;font-weight:700;color:#333;margin-top:12px}
  .brand{font-size:11px;color:#999;margin-top:6px;letter-spacing:.5px}
  .hint{text-align:center;color:#666;padding:10px;font-size:13px}
  @media print{ .hint{display:none} .card{border-color:#000} }
</style></head><body>
<div class="hint">Press Ctrl/Cmd+P to print or save as PDF. Cut out each card and mount it at the matching lane.</div>
<div class="grid">${cards}</div>
</body></html>`);
    w.document.close();
  }

  if (authLoading || allowed === null) {
    return <View style={s.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }
  if (!allowed) {
    return (
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        <View style={s.loader}>
          <Ionicons name="lock-closed-outline" size={42} color="#333" />
          <Text style={s.lockText}>Admins only.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Head><title>Lane QR Codes · ArcadeTracker</title></Head>
      <View style={s.header}>
        <Pressable style={s.backBtn} hitSlop={10} onPress={() => router.canGoBack() ? router.back() : router.replace("/admin" as any)}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>Lane QR Codes</Text>
        {Platform.OS === "web" && codes.length > 0 && (
          <Pressable style={s.printBtn} onPress={printCodes}>
            <Ionicons name="print-outline" size={15} color="#000" />
            <Text style={s.printText}>Print / Save</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.intro}>
          <Text style={s.introTitle}>Check-in QR codes for all {lanes.length} skee-ball lanes</Text>
          <Text style={s.introBody}>
            Generate codes and mount one at each lane. Players scan to check their team in. These codes
            <Text style={{ color: "#06b6d4", fontWeight: "800" }}> never expire</Text> — they stay valid until you generate new ones here.
            {"\n\n"}⚠ Generating replaces the existing codes — any previously printed QR codes for these lanes stop working immediately. Requires admin + 2FA.
          </Text>
        </View>

        <Pressable style={[s.genBtn, generating && { opacity: 0.6 }]} onPress={generateAll} disabled={generating}>
          {generating
            ? <ActivityIndicator size="small" color="#000" />
            : <><Ionicons name="qr-code" size={18} color="#000" /><Text style={s.genText}>{codes.length > 0 ? "Regenerate All Codes" : `Generate All ${lanes.length} Codes`}</Text></>}
        </Pressable>

        {Platform.OS === "web" && codes.length > 0 && (
          <Text style={s.printHint}>Tap “Print / Save” above to open a clean printable sheet (or save as PDF).</Text>
        )}

        <View style={s.grid}>
          {codes.map((c) => (
            <View key={c.lane_number} style={s.card}>
              <Text style={s.laneLabel}>LANE {c.lane_number}</Text>
              <View style={s.qrWrap}>
                <Image source={{ uri: c.qr }} style={s.qrImg} contentFit="contain" />
              </View>
              <Text style={s.cap}>Scan to check in your team</Text>
            </View>
          ))}
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", gap: 12 },
  lockText: { color: "#888", fontSize: 15 },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, color: "#fff", fontSize: 18, fontWeight: "900" },
  printBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#06b6d4", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7 },
  printText: { color: "#000", fontWeight: "900", fontSize: 13 },

  content: { paddingHorizontal: 18, paddingTop: 16 },
  intro: {
    backgroundColor: "rgba(6,182,212,0.05)", borderRadius: 16, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: "rgba(6,182,212,0.2)",
  },
  introTitle: { color: "#fff", fontSize: 15, fontWeight: "900", marginBottom: 6 },
  introBody: { color: "#9a9a9a", fontSize: 13, lineHeight: 19 },

  genBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#06b6d4", borderRadius: 14, paddingVertical: 15, marginBottom: 8,
  },
  genText: { color: "#000", fontSize: 15, fontWeight: "900" },
  printHint: { color: "#7a7a7a", fontSize: 12, textAlign: "center", marginBottom: 14 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 14, justifyContent: "center", marginTop: 10 },
  card: {
    width: 250, alignItems: "center",
    backgroundColor: "#0d0d0d", borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: "#1f1f1f",
  },
  laneLabel: { color: "#fff", fontSize: 30, fontWeight: "900", letterSpacing: 1, marginBottom: 12 },
  qrWrap: { backgroundColor: "#fff", borderRadius: 12, padding: 10 },
  qrImg: { width: 200, height: 200 },
  cap: { color: "#8a8a8a", fontSize: 12, fontWeight: "600", marginTop: 12 },
});
