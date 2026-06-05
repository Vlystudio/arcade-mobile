import { Image } from "expo-image";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Avatar } from "../components/avatar";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useRequireAuth } from "../hooks/use-require-auth";
import { pickFromCamera, pickFromLibrary } from "../../lib/pick-image";
import {
  getOrCreateKeypair,
  encryptMessage,
  decryptForRecipient,
  decryptSenderCopy,
  b64,
  type KeyPair,
} from "../../lib/crypto";

import { API_BASE as MOD_BASE } from "../../lib/api-base";

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
    return decryptSenderCopy(raw.sender_copy, raw.sender_nonce, kp.publicKey, kp.secretKey) ?? raw.content ?? "";
  }
  return decryptForRecipient(raw.encrypted_content, raw.nonce, raw.sender_public_key, kp.secretKey) ?? raw.content ?? "";
}

async function compressImage(uri: string): Promise<{ uri: string; blob: Blob } | null> {
  try {
    const r1 = await manipulateAsync(uri, [{ resize: { width: 1200 } }], { compress: 0.75, format: SaveFormat.JPEG });
    const blob1 = await (await fetch(r1.uri)).blob();
    if (blob1.size <= MAX_BYTES) return { uri: r1.uri, blob: blob1 };

    const r2 = await manipulateAsync(uri, [{ resize: { width: 800 } }], { compress: 0.6, format: SaveFormat.JPEG });
    const blob2 = await (await fetch(r2.uri)).blob();
    if (blob2.size <= MAX_BYTES) return { uri: r2.uri, blob: blob2 };

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mediaPickerVisible, setMediaPickerVisible] = useState(false);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  const myKeypair = useRef<KeyPair | null>(null);
  const recipientPubKey = useRef<Uint8Array | null>(null);

  async function initCrypto() {
    if (!user) return;
    const kp = await getOrCreateKeypair(user.id);
    myKeypair.current = kp;
    await supabase.from("user_public_keys").upsert(
      { user_id: user.id, public_key: b64.encode(kp.publicKey), updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (otherUserId) {
      const { data } = await supabase
        .from("user_public_keys")
        .select("public_key")
        .eq("user_id", otherUserId)
        .maybeSingle();
      if (data?.public_key) recipientPubKey.current = b64.decode(data.public_key);
    }
  }

  async function loadMessages() {
    if (!conversationId) return;
    const { data } = await supabase
      .from("messages")
      .select("id, sender_id, content, image_url, encrypted_content, nonce, sender_copy, sender_nonce, sender_public_key, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    const kp = myKeypair.current;
    const decoded: Message[] = (data ?? []).map((raw: RawMessage) => ({
      id: raw.id,
      sender_id: raw.sender_id,
      content: kp ? decryptMsg(raw, kp, user!.id) : (raw.content ?? ""),
      image_url: raw.image_url ?? null,
      created_at: raw.created_at,
    }));
    setMessages(decoded);
    setLoading(false);
  }

  useEffect(() => {
    if (!user || !conversationId) return;

    initCrypto().then(() => loadMessages());

    const channel = supabase
      .channel(`conv:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const raw = payload.new as RawMessage;
          const kp = myKeypair.current;
          const msg: Message = {
            id: raw.id,
            sender_id: raw.sender_id,
            content: kp ? decryptMsg(raw, kp, user!.id) : (raw.content ?? ""),
            image_url: raw.image_url ?? null,
            created_at: raw.created_at,
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, conversationId]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [loading]);

  async function sendMessage() {
    if (!text.trim() || !user || !conversationId || sending) return;
    const content = text.trim();
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

    let insertData: Record<string, any> = {
      conversation_id: conversationId,
      sender_id: user.id,
      content: "[encrypted]",
    };

    if (myKeypair.current && recipientPubKey.current) {
      const payload = encryptMessage(content, recipientPubKey.current, myKeypair.current);
      insertData = {
        ...insertData,
        encrypted_content: payload.encrypted,
        nonce: payload.nonce,
        sender_copy: payload.senderCopy,
        sender_nonce: payload.senderNonce,
        sender_public_key: payload.senderPublicKey,
      };
    } else {
      insertData.content = content;
    }

    const { error } = await supabase.from("messages").insert(insertData);
    if (!error) {
      await supabase
        .from("conversations")
        .update({ last_message: content, last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
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

    const path = `${user.id}/${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("message-media")
      .upload(path, compressed.blob, { contentType: "image/jpeg", upsert: false });

    if (uploadError) {
      Alert.alert("Upload failed", uploadError.message);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("message-media").getPublicUrl(path);

    try {
      const r = await fetch(`${MOD_BASE}/api/moderation/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: urlData.publicUrl }),
      });
      if (r.ok) {
        const mod = await r.json();
        if (mod.flagged) {
          await supabase.storage.from("message-media").remove([path]);
          Alert.alert("Image blocked", "Your image was flagged for inappropriate content and was not sent.");
          setUploading(false);
          return;
        }
      }
    } catch { /* allow if moderation unavailable */ }

    const { error: msgError } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content: "",
      image_url: urlData.publicUrl,
    });

    if (!msgError) {
      await supabase
        .from("conversations")
        .update({ last_message: "📷 Photo", last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
    }
    setUploading(false);
  }

  if (authLoading || loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color="#06b6d4" /></View>;
  }

  const isEncrypted = !!(myKeypair.current && recipientPubKey.current);

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
              {isEncrypted && (
                <Text style={styles.headerEncrypted}>
                  <Ionicons name="lock-closed" size={10} color="#22c55e" /> End-to-end encrypted
                </Text>
              )}
            </View>
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
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
            placeholderTextColor="#333"
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
  emptyChatText: { color: "#444", fontSize: 14 },
  timestamp: { color: "#444", fontSize: 11, textAlign: "center", marginVertical: 12 },

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
    borderTopWidth: 1, borderColor: "#1e1e1e", gap: 10,
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
  pickerCancelText: { color: "#555", fontWeight: "700", fontSize: 15 },

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
