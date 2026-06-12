import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";
import { showToast } from "./toast";

export type ReportTarget = {
  type: "post" | "comment" | "forum_post" | "forum_comment" | "profile";
  id: string;
  /** Shown in the sheet header, e.g. a username or content snippet */
  label?: string;
};

const REASONS: { key: string; label: string; icon: string }[] = [
  { key: "spam", label: "Spam", icon: "megaphone-outline" },
  { key: "harassment", label: "Harassment or bullying", icon: "person-remove-outline" },
  { key: "racism", label: "Hate speech or racism", icon: "ban-outline" },
  { key: "violence", label: "Violence or threats", icon: "warning-outline" },
  { key: "nudity", label: "Nudity or sexual content", icon: "eye-off-outline" },
  { key: "inappropriate_picture", label: "Inappropriate picture", icon: "image-outline" },
  { key: "inappropriate_text", label: "Inappropriate language", icon: "chatbox-outline" },
  { key: "impersonation", label: "Impersonation", icon: "people-outline" },
  { key: "false_information", label: "False information", icon: "alert-circle-outline" },
  { key: "other", label: "Something else", icon: "ellipsis-horizontal-outline" },
];

/**
 * Shared report flow for posts, comments, forum content, and profiles.
 * Render with a target to open; call onClose to dismiss.
 */
export function ReportSheet({ target, onClose }: {
  target: ReportTarget | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setReason(null);
    setDetails("");
    setError(null);
    onClose();
  }

  async function submit() {
    if (!target || !reason || submitting) return;
    setSubmitting(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("rpc_report_content", {
      p_content_type: target.type,
      p_content_id: target.id,
      p_reason: reason,
      p_details: details.trim() || null,
    });
    setSubmitting(false);
    const code = (data as any)?.error;
    if (rpcError || code) {
      setError(
        code === "cannot_report_own_content" ? "You can't report your own content."
        : code === "not_found" ? "This content no longer exists."
        : "Could not submit the report. Please try again.",
      );
      return;
    }
    close();
    showToast("Report submitted — our team will review it");
  }

  const isProfile = target?.type === "profile";

  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={close}>
      <View style={s.bg}>
        <Pressable style={s.dismiss} onPress={close} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.title}>{isProfile ? "Report User" : "Report Content"}</Text>
          {target?.label ? <Text style={s.sub} numberOfLines={1}>{target.label}</Text> : null}

          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            {REASONS.map((r) => {
              const active = reason === r.key;
              return (
                <Pressable
                  key={r.key}
                  style={[s.reasonRow, active && s.reasonRowActive]}
                  onPress={() => setReason(r.key)}
                >
                  <Ionicons name={r.icon as any} size={17} color={active ? "#ef4444" : "#777"} />
                  <Text style={[s.reasonText, active && s.reasonTextActive]}>{r.label}</Text>
                  <Ionicons
                    name={active ? "radio-button-on" : "radio-button-off"}
                    size={18}
                    color={active ? "#ef4444" : "#333"}
                  />
                </Pressable>
              );
            })}
          </ScrollView>

          {reason && (
            <TextInput
              style={s.detailsInput}
              placeholder="Add details (optional)…"
              placeholderTextColor="#555"
              value={details}
              onChangeText={setDetails}
              multiline
              maxLength={500}
            />
          )}

          {error && (
            <View style={s.errorRow}>
              <Ionicons name="alert-circle-outline" size={14} color="#ef4444" />
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}

          <Pressable style={s.guidelinesLink} onPress={() => { close(); router.push("/guidelines" as any); }}>
            <Text style={s.guidelinesText}>See our community guidelines</Text>
          </Pressable>

          <Pressable
            style={[s.submitBtn, (!reason || submitting) && { opacity: 0.4 }]}
            onPress={submit}
            disabled={!reason || submitting}
          >
            {submitting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.submitText}>Submit Report</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  dismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 22, paddingTop: 14, paddingBottom: 32,
    borderTopWidth: 1, borderColor: "#1e1e1e",
    width: "100%", maxWidth: 560, alignSelf: "center",
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 14 },
  title: { color: "#fff", fontSize: 17, fontWeight: "900", textAlign: "center" },
  sub: { color: "#777", fontSize: 12.5, textAlign: "center", marginTop: 3, marginBottom: 10 },
  reasonRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 10, borderRadius: 12,
  },
  reasonRowActive: { backgroundColor: "rgba(239,68,68,0.06)" },
  reasonText: { flex: 1, color: "#ccc", fontSize: 14.5, fontWeight: "600" },
  reasonTextActive: { color: "#fff", fontWeight: "700" },
  detailsInput: {
    backgroundColor: "#0a0a0a", borderRadius: 12, borderWidth: 1, borderColor: "#222",
    color: "#fff", fontSize: 14, padding: 12, minHeight: 64, maxHeight: 110,
    textAlignVertical: "top", marginTop: 8,
  },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },
  guidelinesLink: { alignSelf: "center", marginTop: 12, marginBottom: 4 },
  guidelinesText: { color: "#06b6d4", fontSize: 12.5, fontWeight: "600" },
  submitBtn: {
    backgroundColor: "#ef4444", borderRadius: 14, paddingVertical: 15,
    alignItems: "center", marginTop: 10,
  },
  submitText: { color: "#fff", fontSize: 15, fontWeight: "900" },
});
