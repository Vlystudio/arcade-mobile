import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as ImagePicker from "expo-image-picker";
import { router, usePathname } from "expo-router";
import Head from "expo-router/head";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
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
import { supabase } from "../../lib/supabase";
import { showToast } from "../components/toast";
import { ListSkeleton } from "../components/skeleton";
import { useRequireAuth } from "../hooks/use-require-auth";

const CATEGORIES = [
  { key: "bug",           label: "Bug",           icon: "bug-outline",            color: "#ef4444" },
  { key: "glitch",        label: "Glitch",        icon: "flash-outline",          color: "#f59e0b" },
  { key: "visual",        label: "Visual",        icon: "color-palette-outline",  color: "#a855f7" },
  { key: "performance",   label: "Slow",          icon: "speedometer-outline",    color: "#06b6d4" },
  { key: "crash",         label: "Crash",         icon: "skull-outline",          color: "#f97316" },
  { key: "site_breaking", label: "Site-breaking", icon: "warning-outline",        color: "#dc2626" },
  { key: "suggestion",    label: "Idea",          icon: "bulb-outline",           color: "#22c55e" },
] as const;

const SEVERITIES = [
  { key: "low",      label: "Low",      color: "#22c55e", hint: "Cosmetic / minor annoyance" },
  { key: "medium",   label: "Medium",   color: "#f59e0b", hint: "Feature misbehaves but has a workaround" },
  { key: "high",     label: "High",     color: "#f97316", hint: "Feature unusable" },
  { key: "critical", label: "Critical", color: "#ef4444", hint: "Site/app broken, data wrong, payments affected" },
] as const;

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  open:        { label: "Open",         color: "#06b6d4" },
  triaged:     { label: "Triaged",      color: "#a855f7" },
  in_progress: { label: "In progress",  color: "#f59e0b" },
  fixed:       { label: "Fixed ✓",      color: "#22c55e" },
  wont_fix:    { label: "Won't fix",    color: "#777" },
  duplicate:   { label: "Duplicate",    color: "#777" },
};

type MyReport = {
  id: string; category: string; severity: string; title: string;
  status: string; admin_note: string | null; created_at: string;
};

export default function BetaFeedbackScreen() {
  const { user, loading: authLoading } = useRequireAuth();
  const pathname = usePathname();

  const [isBeta, setIsBeta] = useState<boolean | null>(null);

  const [category, setCategory] = useState<string>("bug");
  const [severity, setSeverity] = useState<string>("medium");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [myReports, setMyReports] = useState<MyReport[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const appVersion = `${Constants.expoConfig?.version ?? "?"}${(Constants.expoConfig as any)?.extra?.commit ? "" : ""}`;
  const deviceInfo = `${Device.modelName ?? "unknown"} / ${Device.osName ?? Platform.OS} ${Device.osVersion ?? ""}`.trim();

  async function load() {
    if (!user) return;
    const [profRes, reportsRes] = await Promise.all([
      supabase.from("profiles").select("is_beta_tester").eq("id", user.id).single(),
      supabase.from("beta_reports")
        .select("id, category, severity, title, status, admin_note, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    setIsBeta(!!(profRes.data as any)?.is_beta_tester);
    setMyReports((reportsRes.data ?? []) as MyReport[]);
    setRefreshing(false);
  }

  useEffect(() => { if (user) load(); }, [user]);

  async function attachScreenshot() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showToast("Allow photo access to attach a screenshot.", "error"); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) setImageUri(result.assets[0].uri);
  }

  async function submit() {
    if (submitting) return;
    if (title.trim().length < 3) { showToast("Give it a short title first.", "error"); return; }
    if (description.trim().length < 3) { showToast("Describe what happened.", "error"); return; }
    setSubmitting(true);

    let screenshotUrl: string | null = null;
    if (imageUri) {
      try {
        const filename = `beta/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        const res = await fetch(imageUri);
        const blob = await res.blob();
        const { error: upErr } = await supabase.storage
          .from("bug-reports")
          .upload(filename, blob, { contentType: "image/jpeg", upsert: false });
        if (!upErr) {
          const { data } = supabase.storage.from("bug-reports").getPublicUrl(filename);
          screenshotUrl = data.publicUrl;
        }
      } catch {}
    }

    const { data, error } = await supabase.rpc("rpc_beta_submit_report", {
      p_category: category,
      p_severity: severity,
      p_title: title.trim(),
      p_description: description.trim(),
      p_steps: steps.trim() || null,
      p_route: pathname,
      p_platform: Platform.OS,
      p_app_version: appVersion,
      p_device_info: deviceInfo,
      p_screenshot_url: screenshotUrl,
    });
    setSubmitting(false);
    if (error || data?.error) {
      showToast(data?.message ?? "Couldn't send the report.", "error");
      return;
    }
    showToast("Report filed — thank you! 🧪");
    setTitle(""); setDescription(""); setSteps(""); setImageUri(null);
    setSeverity("medium"); setCategory("bug");
    load();
  }

  if (authLoading || isBeta === null) {
    return (
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        <View style={{ paddingHorizontal: 18, paddingTop: 60 }}>
          <ListSkeleton rows={5} />
        </View>
      </SafeAreaView>
    );
  }

  if (!isBeta) {
    return (
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
        <View style={s.header}>
          <Pressable style={s.backBtn} hitSlop={10} onPress={() => router.canGoBack() ? router.back() : router.replace("/profile" as any)}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Text style={s.headerTitle}>Beta Feedback</Text>
        </View>
        <View style={s.loader}>
          <Ionicons name="flask-outline" size={42} color="#333" />
          <Text style={{ color: "#888", fontSize: 14, textAlign: "center", paddingHorizontal: 40 }}>
            This tool is for beta testers. Ask an admin to add you to the beta program.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <Head><title>Beta Feedback · ArcadeTracker</title></Head>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={s.header}>
          <Pressable style={s.backBtn} hitSlop={10} onPress={() => router.canGoBack() ? router.back() : router.replace("/profile" as any)}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Text style={s.headerTitle}>Beta Feedback</Text>
          <View style={s.betaPill}>
            <Ionicons name="flask" size={12} color="#2dd4bf" />
            <Text style={s.betaPillText}>BETA</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#2dd4bf" />}
        >
          <Text style={s.intro}>
            Found something broken, weird, or slow? File it here — reports go straight to the build queue with your device context attached automatically.
          </Text>

          {/* Category */}
          <Text style={s.fieldLabel}>WHAT KIND OF ISSUE?</Text>
          <View style={s.chipWrap}>
            {CATEGORIES.map((c) => (
              <Pressable
                key={c.key}
                style={[s.chip, category === c.key && { backgroundColor: `${c.color}1f`, borderColor: `${c.color}66` }]}
                onPress={() => setCategory(c.key)}
              >
                <Ionicons name={c.icon as any} size={14} color={category === c.key ? c.color : "#666"} />
                <Text style={[s.chipText, category === c.key && { color: c.color }]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Severity */}
          <Text style={s.fieldLabel}>HOW BAD IS IT?</Text>
          <View style={s.sevRow}>
            {SEVERITIES.map((v) => (
              <Pressable
                key={v.key}
                style={[s.sevBtn, severity === v.key && { backgroundColor: `${v.color}1f`, borderColor: `${v.color}77` }]}
                onPress={() => setSeverity(v.key)}
              >
                <Text style={[s.sevBtnText, severity === v.key && { color: v.color }]}>{v.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.sevHint}>{SEVERITIES.find((v) => v.key === severity)?.hint}</Text>

          {/* Title + description + steps */}
          <Text style={s.fieldLabel}>TITLE</Text>
          <TextInput
            style={s.input}
            placeholder="One line, e.g. “Leaderboard shows wrong week”"
            placeholderTextColor="#555"
            value={title}
            onChangeText={setTitle}
            maxLength={120}
          />

          <Text style={s.fieldLabel}>WHAT HAPPENED?</Text>
          <TextInput
            style={[s.input, s.multiline]}
            placeholder="What you saw vs. what you expected…"
            placeholderTextColor="#555"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={4000}
          />

          <Text style={s.fieldLabel}>STEPS TO REPRODUCE <Text style={s.optional}>(optional, but gold)</Text></Text>
          <TextInput
            style={[s.input, s.multiline]}
            placeholder={"1. Open Teams\n2. Tap the gear\n3. …"}
            placeholderTextColor="#555"
            value={steps}
            onChangeText={setSteps}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={4000}
          />

          {/* Screenshot */}
          {imageUri ? (
            <View style={s.shotWrap}>
              <Image source={{ uri: imageUri }} style={s.shotPreview} resizeMode="cover" />
              <Pressable style={s.shotRemove} onPress={() => setImageUri(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={24} color="#ef4444" />
              </Pressable>
            </View>
          ) : (
            <Pressable style={s.attachBtn} onPress={attachScreenshot}>
              <Ionicons name="image-outline" size={18} color="#777" />
              <Text style={s.attachText}>Attach a screenshot</Text>
            </Pressable>
          )}

          {/* Auto-context */}
          <View style={s.contextCard}>
            <Ionicons name="hardware-chip-outline" size={13} color="#555" />
            <Text style={s.contextText}>
              Attached automatically: {Platform.OS} · v{appVersion} · {deviceInfo}
            </Text>
          </View>

          <Pressable style={[s.submitBtn, submitting && { opacity: 0.6 }]} onPress={submit} disabled={submitting}>
            {submitting
              ? <ActivityIndicator size="small" color="#000" />
              : <>
                  <Ionicons name="paper-plane" size={16} color="#000" />
                  <Text style={s.submitText}>File Report</Text>
                </>}
          </Pressable>

          {/* My reports */}
          {myReports.length > 0 && (
            <>
              <Text style={[s.fieldLabel, { marginTop: 26 }]}>MY REPORTS</Text>
              {myReports.map((r) => {
                const st = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.open;
                const cat = CATEGORIES.find((c) => c.key === r.category);
                return (
                  <View key={r.id} style={s.reportRow}>
                    <Ionicons name={(cat?.icon ?? "bug-outline") as any} size={16} color={cat?.color ?? "#888"} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.reportTitle} numberOfLines={1}>{r.title}</Text>
                      <Text style={s.reportMeta}>
                        {new Date(r.created_at).toLocaleDateString([], { month: "short", day: "numeric" })} · {r.severity}
                        {r.admin_note ? ` · “${r.admin_note}”` : ""}
                      </Text>
                    </View>
                    <View style={[s.statusPill, { borderColor: `${st.color}55`, backgroundColor: `${st.color}14` }]}>
                      <Text style={[s.statusPillText, { color: st.color }]}>{st.label}</Text>
                    </View>
                  </View>
                );
              })}
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", gap: 14 },

  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, color: "#fff", fontSize: 18, fontWeight: "900" },
  betaPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(45,212,191,0.1)", borderWidth: 1, borderColor: "rgba(45,212,191,0.35)",
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  betaPillText: { color: "#2dd4bf", fontSize: 10.5, fontWeight: "900", letterSpacing: 1 },

  content: { paddingHorizontal: 18 },
  intro: { color: "#999", fontSize: 13, lineHeight: 19, marginBottom: 16 },

  fieldLabel: { color: "#666", fontSize: 11, fontWeight: "800", letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  optional: { color: "#444", fontWeight: "600", letterSpacing: 0 },

  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#0d0d0d", borderRadius: 999,
    paddingHorizontal: 13, paddingVertical: 8,
    borderWidth: 1, borderColor: "#222",
  },
  chipText: { color: "#888", fontSize: 12.5, fontWeight: "700" },

  sevRow: { flexDirection: "row", gap: 8 },
  sevBtn: {
    flex: 1, alignItems: "center", backgroundColor: "#0d0d0d",
    borderRadius: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#222",
  },
  sevBtnText: { color: "#888", fontSize: 12.5, fontWeight: "800" },
  sevHint: { color: "#555", fontSize: 11.5, marginTop: 6, marginBottom: 16 },

  input: {
    backgroundColor: "#0d0d0d", borderRadius: 14, borderWidth: 1, borderColor: "#1e1e1e",
    color: "#fff", fontSize: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16,
  },
  multiline: { minHeight: 90, lineHeight: 20 },

  attachBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#0d0d0d", borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: "#222", borderStyle: "dashed", marginBottom: 14,
  },
  attachText: { color: "#777", fontSize: 13, fontWeight: "600" },
  shotWrap: { position: "relative", borderRadius: 14, overflow: "hidden", marginBottom: 14 },
  shotPreview: { width: "100%", height: 180 },
  shotRemove: { position: "absolute", top: 8, right: 8, backgroundColor: "#000", borderRadius: 12 },

  contextCard: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#0a0a0a", borderRadius: 10, padding: 10, marginBottom: 16,
    borderWidth: 1, borderColor: "#161616",
  },
  contextText: { flex: 1, color: "#555", fontSize: 11.5, lineHeight: 16 },

  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#2dd4bf", borderRadius: 14, paddingVertical: 15,
  },
  submitText: { color: "#000", fontSize: 15, fontWeight: "900" },

  reportRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#161616",
  },
  reportTitle: { color: "#ddd", fontSize: 13.5, fontWeight: "700" },
  reportMeta: { color: "#666", fontSize: 11.5, marginTop: 2 },
  statusPill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  statusPillText: { fontSize: 10.5, fontWeight: "800" },
});
