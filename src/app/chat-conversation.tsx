import { messageImageReference, resolveMessageImage } from "../../lib/message-media";
import { Image } from "expo-image";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Avatar } from "../components/avatar";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Alert } from "../../lib/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useRequireAuth } from "../hooks/use-require-auth";
import { pickFromCamera, pickFromLibrary } from "../../lib/pick-image";
import {
  getStoredKeypair,
  decryptForRecipient,
  decryptSenderCopy,
  b64,
  type KeyPair,
} from "../../lib/crypto";

import { API_BASE as MOD_BASE } from "../../lib/api-base";
import { validateChatMessage } from "../../lib/validation";

const MAX_BYTES = 5 * 1024 * 1024;

type RawMessage = {
  id: string;
  sender_id: string;
  content: string;
  image_url?: string | null;
  encrypted_content?: string | null;
  nonce?: string | null;
  sender_copy?: string | null;
  sender_nonce?: string | null;
  sender_public_key?: string | null;
  created_at: string;
};

type Message = {
  id: string;
  sender_id: string;
  content: string;
  image_url?: string | null;
  created_at: string;
};

function decryptMsg(raw: RawMessage, kp: KeyPair, myUserId: string): string {
  if (!raw.encrypted_content || !raw.nonce || !raw.sender_public_key) {
    return raw.content ?? "";
  }
  if (raw.sender_id === myUserId) {
    if (!raw.sender_copy || !raw.sender_nonce) return raw.content ?? "";
    return decryptSenderCopy(raw.sender_copy, raw.sender_nonce, kp.publicKey, kp.secretKey) ?? "This older encrypted message is unavailable on this device.";
  }
  return decryptForRecipient(raw.encrypted_content, raw.nonce, raw.sender_public_key, kp.secretKey) ?? "This older encrypted message is unavailable on this device.";
}

async function compressImage(uri: string): Promise<{ uri: string; bytes: ArrayBuffer } | null> {
  try {
    const r1 = await manipulateAsync(uri, [{ resize: { width: 1200 } }], { compress: 0.75, format: SaveFormat.JPEG, base64: true });
    const bytes1 = new Uint8Array(b64.decode(r1.base64!)).buffer;
    if (bytes1.byteLength <= MAX_BYTES) return { uri: r1.uri, bytes: bytes1 };

    const r2 = await manipulateAsync(uri, [{ resize: { width: 800 } }], { compress: 0.6, format: SaveFormat.JPEG, base64: true });
    const bytes2 = new Uint8Array(b64.decode(r2.base64!)).buffer;
    if (bytes2.byteLength <= MAX_BYTES) return { uri: r2.uri, bytes: bytes2 };

    return null;
  } catch {
    return null;
  }
}

export default function ChatConversationScreen() {
  const { conversationId, otherUsername, otherAvatarUrl, otherUserId } = useLocalSearchParams<{
    conversationId: string;
    otherUsername: string;
    otherAvatarUrl: string;
    otherUserId: string;
  }>();
  const { user, loading: authLoading } = useRequireAuth();
  const userId = user?.id;
  const initialScrollDone = useRef(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mediaPickerVisible, setMediaPickerVisible] = useState(false);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const loadOlder = useRef<() => Promise<void>>(async () => {});
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    if (!userId || !conversationId) return;
    let active = true;
    let busy = false;
    let renderVersion = 0;
    let keypair: KeyPair | null = null;
    let cursor: RawMessage | undefined;
    const rawMessages = new Map<string, RawMessage>();
    initialScrollDone.current = false;
    setMessages([]);
    setLoading(true);
    setHasOlder(false);
    setLoadingOlder(false);

    const renderMessages = async () => {
      const version = ++renderVersion;
      const sorted = [...rawMessages.values()].sort((a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      const decoded = await Promise.all(sorted.map(async raw => ({
        id: raw.id, sender_id: raw.sender_id, created_at: raw.created_at,
        content: keypair ? decryptMsg(raw, keypair, userId)
          : raw.encrypted_content ? "This older encrypted message is unavailable on this device." : raw.content ?? "",
        image_url: await resolveMessageImage(raw.image_url, conversationId),
      })));
      if (active && version === renderVersion) setMessages(decoded);
    };
    const page = async (older = false) => {
      if (busy || !active || (older && !cursor)) return;
      busy = true;
      if (older) setLoadingOlder(true);
      try {
        let query = supabase.from("messages")
          .select("id, sender_id, content, image_url, encrypted_content, nonce, sender_copy, sender_nonce, sender_public_key, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50);
        if (older && cursor) {
          query = query.or("created_at.lt." + cursor.created_at + ",and(created_at.eq." + cursor.created_at + ",id.lt." + cursor.id + ")");
        }
        const { data, error } = await query;
        if (error) throw error;
        if (!active) return;
        const rows = (data ?? []) as RawMessage[];
        rows.forEach(raw => rawMessages.set(raw.id, raw));
        cursor = rows.at(-1);
        setHasOlder(rows.length === 50);
        await renderMessages();
      } catch {
        if (active) Alert.alert("Messages unavailable", "Please try loading this conversation again.");
      } finally {
        busy = false;
        if (active) { setLoading(false); setLoadingOlder(false); }
      }
    };
    loadOlder.current = () => page(true);
    void (async () => {
      keypair = await getStoredKeypair(userId).catch(() => null);
      await page();
    })();
    const refreshImages = setInterval(() => { void renderMessages(); }, 30 * 60 * 1000);
    const channel = supabase.channel("conv:" + conversationId)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: "conversation_id=eq." + conversationId },
        async payload => {
          if (!active) return;
          const raw = payload.new as RawMessage;
          rawMessages.set(raw.id, raw);
          await renderMessages();
          if (active) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
        })
      .subscribe();
    return () => {
      active = false;
      loadOlder.current = async () => {};
      clearInterval(refreshImages);
      void supabase.removeChannel(channel);
    };
  }, [userId, conversationId]);

  useEffect(() => {
    if (!loading && messages.length > 0 && !initialScrollDone.current) {
      initialScrollDone.current = true;
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [loading, messages.length]);

  async function sendMessage() {
    const message = validateChatMessage(text);
    if (!message.ok || !user || !conversationId || sending) return;
    const content = message.value;
    setSending(true);

    try {
      const r = await fetch(`${MOD_BASE}/api/moderation/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content }),
      });
      if (r.ok) {
        const mod = await r.json();
        if (mod.flagged) {
          setSending(false);
          Alert.alert("Message blocked", "Your message violates our community guidelines and cannot be sent.");
          return;
        }
      }
    } catch { /* allow if moderation unavailable */ }

    setText("");

    // Moderated chat is server-readable. New messages work across all signed-in devices.
    const insertData = { conversation_id: conversationId, sender_id: user.id, content };

    const { error } = await supabase.from("messages").insert(insertData);
    if (!error) {
      await supabase
        .from("conversations")
        .update({ last_message: "New message", last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
    }
    if (error) {
      setText(content);
      Alert.alert("Message not sent", "Please try again.");
    }
    setSending(false);
  }

  async function sendImage(source: "camera" | "library") {
    if (!user || !conversationId) return;
    setMediaPickerVisible(false);

    const asset = source === "camera"
      ? await pickFromCamera({ allowsEditing: false, quality: 0.85 })
      : await pickFromLibrary({ allowsEditing: false, quality: 0.85 });
    if (!asset) return;

    setUploading(true);
    const compressed = await compressImage(asset.uri);
    if (!compressed) {
      Alert.alert("Image too large", "Could not compress under 5MB. Please choose a smaller photo.");
      setUploading(false);
      return;
    }

    const path = `${conversationId}/${user.id}/${Date.now()}.jpg`;
    try {
      const { error: uploadError } = await supabase.storage.from("message-media")
        .upload(path, compressed.bytes, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw uploadError;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Sign in before sending a photo.");
      const response = await fetch(`${MOD_BASE}/api/moderation/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ path }),
      });
      const moderation = await response.json();
      if (!response.ok || moderation.ok !== true || moderation.flagged) {
        throw new Error(moderation.flagged ? "Please choose an appropriate image." : "Your photo could not be verified. Please try again.");
      }
      const { error } = await supabase.from("messages").insert({
        conversation_id: conversationId, sender_id: user.id, content: "", image_url: messageImageReference(path),
      });
      if (error) throw error;
      await supabase.from("conversations").update({ last_message: "Photo", last_message_at: new Date().toISOString() }).eq("id", conversationId);
    } catch (error) {
      await supabase.storage.from("message-media").remove([path]);
      Alert.alert("Photo not sent", error instanceof Error ? error.message : "Please try again.");
    } finally { setUploading(false); }
  }

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }


  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>

        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace("/chat" as any)}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Pressable
            style={styles.headerProfile}
            onPress={() => otherUserId && router.push({ pathname: "/user-profile" as any, params: { userId: otherUserId } })}
          >
            <Avatar uri={otherAvatarUrl || null} name={otherUsername ?? "?"} size={36} />
            <View>
              <Text style={styles.headerName}>{otherUsername ?? "Chat"}</Text>
                <Text style={styles.headerEncrypted}>
                  Messages are stored for moderation.
                </Text>
            </View>
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          ListHeaderComponent={hasOlder ? (
            <Pressable onPress={() => void loadOlder.current()} disabled={loadingOlder} accessibilityRole="button" style={{ padding: 16 }}>
              <Text style={{ color: "#67e8f9", textAlign: "center" }}>{loadingOlder ? "Loading..." : "Load older messages"}</Text>
            </Pressable>
          ) : null}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatText}>No messages yet. Say hello!</Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const isMe = item.sender_id === user?.id;
            const prevMsg = index > 0 ? messages[index - 1] : null;
            const showTime = !prevMsg || (new Date(item.created_at).getTime() - new Date(prevMsg.created_at).getTime()) > 5 * 60 * 1000;

            return (
              <>
                {showTime && <Text style={styles.timestamp}>{fmtTime(item.created_at)}</Text>}
                <View style={[styles.bubbleWrap, isMe && styles.bubbleWrapMe]}>
                  <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, !!item.image_url && styles.bubbleImg]}>
                    {item.image_url && (
                      <Pressable onPress={() => setViewingImage(item.image_url!)}>
                        <Image source={{ uri: item.image_url }} style={styles.msgImage} contentFit="cover" />
                      </Pressable>
                    )}
                    {!!item.content && (
                      <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe, !!item.image_url && { paddingTop: 6 }]}>
                        {item.content}
                      </Text>
                    )}
                  </View>
                </View>
              </>
            );
          }}
        />

        <View style={styles.inputBar}>
          <Pressable style={styles.mediaBtn} onPress={() => setMediaPickerVisible(true)} disabled={uploading || sending}>
            {uploading
              ? <ActivityIndicator size="small" color="#555" />
              : <Ionicons name="image-outline" size={22} color="#555" />}
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder="Message…"
            placeholderTextColor="#555"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={1000}
            returnKeyType="default"
          />
          <Pressable
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnOff]}
            onPress={sendMessage}
            disabled={!text.trim() || sending}
          >
            <Ionicons name="arrow-up" size={18} color={text.trim() ? "#000" : "#333"} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Photo source picker */}
      <Modal visible={mediaPickerVisible} transparent animationType="slide" onRequestClose={() => setMediaPickerVisible(false)}>
        <View style={styles.pickerBg}>
          <Pressable style={styles.pickerDismiss} onPress={() => setMediaPickerVisible(false)} />
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Send Photo</Text>
            <Pressable style={styles.pickerOptCamera} onPress={() => sendImage("camera")}>
              <Ionicons name="camera" size={22} color="#000" />
              <Text style={styles.pickerOptCameraText}>Take Photo</Text>
            </Pressable>
            <Pressable style={styles.pickerOptLibrary} onPress={() => sendImage("library")}>
              <Ionicons name="images-outline" size={22} color="#fff" />
              <Text style={styles.pickerOptLibraryText}>Choose from Library</Text>
            </Pressable>
            <Pressable style={styles.pickerCancel} onPress={() => setMediaPickerVisible(false)}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Full-screen image viewer */}
      <Modal visible={!!viewingImage} transparent animationType="fade" onRequestClose={() => setViewingImage(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewingImage(null)}>
          {viewingImage && (
            <Image source={{ uri: viewingImage }} style={styles.viewerImg} contentFit="contain" />
          )}
          <Pressable style={styles.viewerClose} onPress={() => setViewingImage(null)}>
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#000" },
  root: { flex: 1 },
  loader: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1a1a1a",
    backgroundColor: "#000",
  },
  backBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  headerProfile: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  headerName: { color: "#fff", fontSize: 16, fontWeight: "800" },
  headerEncrypted: { color: "#22c55e", fontSize: 10, fontWeight: "600", marginTop: 1 },

  messageList: { paddingHorizontal: 16, paddingVertical: 12, gap: 2 },
  emptyChat: { paddingTop: 80, alignItems: "center" },
  emptyChatText: { color: "#777", fontSize: 14 },
  timestamp: { color: "#777", fontSize: 11, textAlign: "center", marginVertical: 12 },

  bubbleWrap: { flexDirection: "row", marginBottom: 3 },
  bubbleWrapMe: { justifyContent: "flex-end" },
  bubble: { maxWidth: "72%", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMe: { backgroundColor: "#06b6d4", borderBottomRightRadius: 5 },
  bubbleThem: { backgroundColor: "#1c1c1c", borderBottomLeftRadius: 5 },
  bubbleImg: { padding: 4, paddingBottom: 8 },
  bubbleText: { color: "#e0e0e0", fontSize: 15, lineHeight: 21 },
  bubbleTextMe: { color: "#000" },

  msgImage: { width: 220, height: 180, borderRadius: 16 },

  inputBar: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1a1a1a",
    backgroundColor: "#000",
  },
  mediaBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1, color: "#fff", fontSize: 15, lineHeight: 21,
    backgroundColor: "#111", borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: "#222", maxHeight: 120,
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "#06b6d4", alignItems: "center", justifyContent: "center",
  },
  sendBtnOff: { backgroundColor: "#111" },

  pickerBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  pickerDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  pickerSheet: {
    backgroundColor: "#111", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36,
    borderTopWidth: 1, borderColor: "#1a1a1a", gap: 10,
  },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a", alignSelf: "center", marginBottom: 4 },
  pickerTitle: { color: "#fff", fontSize: 16, fontWeight: "900", textAlign: "center", marginBottom: 4 },
  pickerOptCamera: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#06b6d4", borderRadius: 16, padding: 16,
  },
  pickerOptCameraText: { color: "#000", fontWeight: "900", fontSize: 16 },
  pickerOptLibrary: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#1a1a1a", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "#2a2a2a",
  },
  pickerOptLibraryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  pickerCancel: { backgroundColor: "#0d0d0d", borderRadius: 16, padding: 16, alignItems: "center" },
  pickerCancelText: { color: "#8a8a8a", fontWeight: "700", fontSize: 15 },

  viewer: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center", justifyContent: "center",
  },
  viewerImg: { width: "100%", height: "80%" },
  viewerClose: {
    position: "absolute", top: 52, right: 20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center",
  },
});
