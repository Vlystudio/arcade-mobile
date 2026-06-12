import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useRequireAuth } from "../hooks/use-require-auth";
import { reportError } from "../lib/report-error";
import { validateSupportFeedback } from "../../lib/validation";

const CATEGORIES = [
  { key: "bug",     label: "Bug Report",       icon: "bug-outline" as const,       color: "#ef4444" },
  { key: "feature", label: "Feature Request",  icon: "bulb-outline" as const,      color: "#f59e0b" },
  { key: "general", label: "General Feedback", icon: "chatbubble-outline" as const, color: "#06b6d4" },
  { key: "other",   label: "Other",            icon: "ellipsis-horizontal-outline" as const, color: "#666" },
] as const;

type Category = typeof CATEGORIES[number]["key"];

export default function FeedbackScreen() {
  useRequireAuth();

  const [category, setCategory]   = useState<Category>("general");
  const [rating, setRating]       = useState<number>(0);
  const [message, setMessage]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [error, setError]           = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const feedback = validateSupportFeedback(message);
    if (!feedback.ok) {
      setError(feedback.error);
      return;
    }
    setSubmitting(true);
    const { data, error: rpcErr } = await supabase.rpc("rpc_submit_feedback", {
      p_category:    category,
      p_message:     feedback.value,
      p_rating:      rating > 0 ? rating : null,
      p_app_version: "1.0.0",
    });
    setSubmitting(false);
    if (rpcErr || (data as any)?.error) {
      const msg = (data as any)?.message ?? rpcErr?.message ?? "Failed to submit. Please try again.";
      reportError("Feedback.handleSubmit", msg);
      setError(msg);
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <SafeAreaView style={s.root} edges={["top", "bottom"]}>
        <View style={s.header}>
          <Pressable style={s.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <Text style={s.headerTitle}>Feedback</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={s.successContainer}>
          <View style={s.successIcon}>
            <Ionicons name="checkmark-circle" size={56} color="#22c55e" />
          </View>
          <Text style={s.successTitle}>Thank you!</Text>
          <Text style={s.successSub}>
            Your feedback has been received. We read everything and use it to make ArcadeTracker better.
          </Text>
          <Pressable style={s.doneBtn} onPress={() => router.back()}>
            <Text style={s.doneBtnText}>Done</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const selectedCat = CATEGORIES.find(c => c.key === category)!;

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>Send Feedback</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.label}>Category</Text>
        <View style={s.categoryRow}>
          {CATEGORIES.map(cat => (
            <Pressable
              key={cat.key}
              style={[s.categoryChip, category === cat.key && { borderColor: cat.color, backgroundColor: `${cat.color}15` }]}
              onPress={() => setCategory(cat.key)}
            >
              <Ionicons name={cat.icon} size={16} color={category === cat.key ? cat.color : "#555"} />
              <Text style={[s.categoryChipText, category === cat.key && { color: cat.color }]}>
                {cat.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[s.label, { marginTop: 24 }]}>Rating (optional)</Text>
        <View style={s.starsRow}>
          {[1, 2, 3, 4, 5].map(star => (
            <Pressable key={star} onPress={() => setRating(rating === star ? 0 : star)} style={s.starBtn}>
              <Ionicons
                name={star <= rating ? "star" : "star-outline"}
                size={28}
                color={star <= rating ? "#f59e0b" : "#333"}
              />
            </Pressable>
          ))}
        </View>

        <Text style={[s.label, { marginTop: 24 }]}>Your feedback</Text>
        <View style={s.textAreaWrap}>
          <TextInput
            style={s.textArea}
            placeholder={
              category === "bug"
                ? "Describe what happened, what you expected, and steps to reproduce…"
                : category === "feature"
                ? "Describe the feature you'd like to see and how it would help…"
                : "Share your thoughts with us…"
            }
            placeholderTextColor="#555"
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={7}
            textAlignVertical="top"
            maxLength={2000}
          />
          <Text style={s.charCount}>{message.length}/2000</Text>
        </View>

        {error && (
          <View style={s.errorBox}>
            <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          style={[s.submitBtn, submitting && s.submitBtnLoading]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#000" size="small" />
            : <>
                <Ionicons name="send-outline" size={18} color="#000" />
                <Text style={s.submitBtnText}>Send Feedback</Text>
              </>
          }
        </Pressable>

        <Text style={s.note}>
          For urgent issues or account problems, use the{" "}
          <Text style={s.noteLink} onPress={() => router.push("/support-chat" as any)}>
            Support Chat
          </Text>
          {" "}instead.
        </Text>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#111", alignItems: "center", justifyContent: "center",
  },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  content: { paddingHorizontal: 20, paddingTop: 24 },

  label: { color: "#888", fontSize: 12, fontWeight: "700", letterSpacing: 0.5, marginBottom: 10, textTransform: "uppercase" },

  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1, borderColor: "#222",
    backgroundColor: "#0d0d0d",
  },
  categoryChipText: { color: "#8a8a8a", fontSize: 13, fontWeight: "700" },

  starsRow: { flexDirection: "row", gap: 8 },
  starBtn: { padding: 4 },

  textAreaWrap: {
    backgroundColor: "#111", borderRadius: 16,
    borderWidth: 1, borderColor: "#1e1e1e",
    padding: 16, minHeight: 160,
  },
  textArea: { color: "#fff", fontSize: 15, lineHeight: 22, flex: 1 },
  charCount: { color: "#333", fontSize: 11, textAlign: "right", marginTop: 8 },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 12,
    padding: 12, marginTop: 12,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.2)",
  },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },

  submitBtn: {
    backgroundColor: "#06b6d4", borderRadius: 14,
    paddingVertical: 16, marginTop: 20,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  submitBtnLoading: { backgroundColor: "#0a4a55" },
  submitBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },

  note: { color: "#777", fontSize: 13, textAlign: "center", marginTop: 16 },
  noteLink: { color: "#06b6d4", fontWeight: "700" },

  successContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  successIcon: { marginBottom: 20 },
  successTitle: { color: "#fff", fontSize: 26, fontWeight: "900", marginBottom: 12 },
  successSub: { color: "#8a8a8a", fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 32 },
  doneBtn: {
    backgroundColor: "#06b6d4", borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 48,
  },
  doneBtnText: { color: "#000", fontWeight: "900", fontSize: 16 },
});
