import { Ionicons } from "@expo/vector-icons";
import * as Device from "expo-device";
import * as ImagePicker from "expo-image-picker";
import { usePathname } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { signalError } from "../lib/error-signal";
import { reportError } from "../lib/report-error";
import { supabase } from "../../lib/supabase";

/**
 * Drop-in replacement for inline red error text.
 * Shows the error + a small "Report" button that opens the bug-report modal.
 *
 * Usage: <BugReportBanner error={error} />
 *   replaces: {error && <View style={styles.errorBox}>...</View>}
 */
export function BugReportBanner({ error }: { error: string | null }) {
  const [open, setOpen] = useState(false);
  // Surface the screenshot button whenever an error is shown to the user
  useEffect(() => { if (error) signalError(); }, [error]);
  if (!error) return null;
  return (
    <>
      <View style={s.banner}>
        <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
        <Text style={s.bannerText}>{error}</Text>
        <Pressable style={s.reportChip} onPress={() => setOpen(true)} hitSlop={8}>
          <Ionicons name="bug-outline" size={11} color="#ef4444" />
          <Text style={s.reportChipText}>Report</Text>
        </Pressable>
      </View>
      {open && <BugReportModal errorMessage={error} onClose={() => setOpen(false)} />}
    </>
  );
}

function BugReportModal({
  errorMessage,
  onClose,
}: {
  errorMessage: string;
  onClose: () => void;
}) {
  const route = usePathname();
  const [description, setDescription] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function pickScreenshot() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        "Allow photo access so you can attach a screenshot.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }

  async function submit() {
    setSubmitting(true);
    try {
      let screenshotUrl: string | null = null;

      if (imageUri) {
        const ext = (imageUri.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z]/g, "") || "jpg";
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const path = `screenshots/${filename}`;

        const res = await fetch(imageUri);
        const blob = await res.blob();

        const { error: uploadErr } = await supabase.storage
          .from("bug-reports")
          .upload(path, blob, { contentType: `image/${ext}`, upsert: false });

        if (!uploadErr) {
          const { data } = supabase.storage.from("bug-reports").getPublicUrl(path);
          screenshotUrl = data.publicUrl;
        }
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      await supabase.from("bug_reports").insert({
        user_id: user?.id ?? null,
        route,
        error_message: errorMessage,
        description: description.trim() || null,
        screenshot_url: screenshotUrl,
        device_info: `${Device.modelName ?? "unknown"} / ${Device.osName ?? ""} ${Device.osVersion ?? ""}`.trim(),
      });

      reportError("BugReport", errorMessage, {
        route,
        description: description.trim(),
        device: Device.modelName,
      });

      setDone(true);
    } catch {
      Alert.alert("Couldn't send report", "Please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setDescription("");
    setImageUri(null);
    setDone(false);
    onClose();
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={s.modal} edges={["top", "bottom"]}>
        {/* Header */}
        <View style={s.modalHeader}>
          <Pressable onPress={handleClose} style={s.closeBtn} hitSlop={8}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          <Text style={s.modalTitle}>Report a Bug</Text>
          <View style={{ width: 38 }} />
        </View>

        {done ? (
          /* Success state */
          <View style={s.successView}>
            <View style={s.successIcon}>
              <Ionicons name="checkmark-circle" size={56} color="#22c55e" />
            </View>
            <Text style={s.successTitle}>Report sent</Text>
            <Text style={s.successBody}>
              Thanks for helping us improve. We'll look into this as soon as possible.
            </Text>
            <Pressable style={s.doneBtn} onPress={handleClose}>
              <Text style={s.doneBtnText}>Done</Text>
            </Pressable>
          </View>
        ) : (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              contentContainerStyle={s.formScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Error preview */}
              <View style={s.errorPreview}>
                <Ionicons name="alert-circle" size={14} color="#ef4444" />
                <Text style={s.errorPreviewText} numberOfLines={4}>
                  {errorMessage}
                </Text>
              </View>

              {/* Screenshot */}
              <Text style={s.fieldLabel}>Screenshot</Text>
              <Text style={s.fieldHint}>
                On your device, press the screenshot button (power + volume down),
                then come back here and tap below to attach it.
              </Text>
              {imageUri ? (
                <View style={s.imageWrap}>
                  <Image source={{ uri: imageUri }} style={s.previewImage} resizeMode="cover" />
                  <Pressable
                    style={s.removeImage}
                    onPress={() => setImageUri(null)}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={26} color="#ef4444" />
                  </Pressable>
                </View>
              ) : (
                <Pressable style={s.attachBtn} onPress={pickScreenshot}>
                  <Ionicons name="image-outline" size={22} color="#555" />
                  <Text style={s.attachBtnText}>Attach screenshot from camera roll</Text>
                </Pressable>
              )}

              {/* Description */}
              <Text style={s.fieldLabel}>What were you doing?</Text>
              <TextInput
                style={s.textInput}
                placeholder="Describe what happened and what you expected..."
                placeholderTextColor="#555"
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />

              <Text style={s.routeNote}>
                Page: {route}
              </Text>

              <Pressable
                style={[s.submitBtn, submitting && { opacity: 0.6 }]}
                onPress={submit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <>
                    <Ionicons name="send-outline" size={16} color="#000" />
                    <Text style={s.submitBtnText}>Send Bug Report</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  /* Banner (inline) */
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.2)",
  },
  bannerText: {
    flex: 1,
    color: "#ef4444",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  reportChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
  reportChipText: {
    color: "#ef4444",
    fontSize: 11,
    fontWeight: "800",
  },

  /* Modal */
  modal: { flex: 1, backgroundColor: "#0a0a0a" },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1a1a1a",
  },
  closeBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
  },

  formScroll: { padding: 20, gap: 16, paddingBottom: 40 },

  errorPreview: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "rgba(239,68,68,0.08)",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.2)",
  },
  errorPreviewText: {
    flex: 1,
    color: "#ef4444",
    fontSize: 13,
    lineHeight: 18,
  },

  fieldLabel: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 0,
    marginTop: 4,
  },
  fieldHint: {
    color: "#8a8a8a",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
    marginBottom: 8,
  },

  attachBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#111",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1a1a1a",
    borderStyle: "dashed",
  },
  attachBtnText: {
    color: "#777",
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },

  imageWrap: { position: "relative", borderRadius: 14, overflow: "hidden" },
  previewImage: { width: "100%", height: 200, borderRadius: 14 },
  removeImage: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "#000",
    borderRadius: 13,
  },

  textInput: {
    backgroundColor: "#111",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1a1a1a",
    color: "#fff",
    fontSize: 14,
    padding: 14,
    minHeight: 100,
    lineHeight: 20,
  },

  routeNote: {
    color: "#333",
    fontSize: 11,
    fontStyle: "italic",
  },

  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#ef4444",
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 4,
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },

  /* Success */
  successView: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(34,197,94,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  successTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
  },
  successBody: {
    color: "#8a8a8a",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  doneBtn: {
    backgroundColor: "#22c55e",
    borderRadius: 14,
    paddingHorizontal: 40,
    paddingVertical: 14,
    marginTop: 12,
  },
  doneBtnText: { color: "#000", fontSize: 15, fontWeight: "900" },
});
