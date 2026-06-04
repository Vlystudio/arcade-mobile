import nacl from "tweetnacl";
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from "tweetnacl-util";
import { Platform } from "react-native";

const PREFIX = "at_e2e_v1_";

async function kv() {
  if (Platform.OS === "web") {
    return {
      get: async (k: string) => localStorage.getItem(k),
      set: async (k: string, v: string) => { localStorage.setItem(k, v); },
    };
  }
  const { default: A } = await import("@react-native-async-storage/async-storage");
  return {
    get: (k: string) => A.getItem(k),
    set: (k: string, v: string) => A.setItem(k, v),
  };
}

export type KeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };

export async function getOrCreateKeypair(userId: string): Promise<KeyPair> {
  const store = await kv();
  const raw = await store.get(PREFIX + userId);
  if (raw) {
    const p = JSON.parse(raw);
    return { publicKey: decodeBase64(p.pk), secretKey: decodeBase64(p.sk) };
  }
  const kp = nacl.box.keyPair();
  await store.set(PREFIX + userId, JSON.stringify({
    pk: encodeBase64(kp.publicKey),
    sk: encodeBase64(kp.secretKey),
  }));
  return kp;
}

export interface EncryptedPayload {
  encrypted: string;
  nonce: string;
  senderCopy: string;
  senderNonce: string;
  senderPublicKey: string;
}

export function encryptMessage(
  plaintext: string,
  recipientPublicKey: Uint8Array,
  sender: KeyPair,
): EncryptedPayload {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const senderNonce = nacl.randomBytes(nacl.box.nonceLength);
  const msg = decodeUTF8(plaintext);
  return {
    encrypted: encodeBase64(nacl.box(msg, nonce, recipientPublicKey, sender.secretKey)),
    nonce: encodeBase64(nonce),
    senderCopy: encodeBase64(nacl.box(msg, senderNonce, sender.publicKey, sender.secretKey)),
    senderNonce: encodeBase64(senderNonce),
    senderPublicKey: encodeBase64(sender.publicKey),
  };
}

export function decryptForRecipient(
  encrypted: string, nonce: string,
  senderPublicKeyB64: string, mySecretKey: Uint8Array,
): string | null {
  try {
    const d = nacl.box.open(decodeBase64(encrypted), decodeBase64(nonce), decodeBase64(senderPublicKeyB64), mySecretKey);
    return d ? encodeUTF8(d) : null;
  } catch { return null; }
}

export function decryptSenderCopy(
  senderCopy: string, senderNonce: string,
  myPublicKey: Uint8Array, mySecretKey: Uint8Array,
): string | null {
  try {
    const d = nacl.box.open(decodeBase64(senderCopy), decodeBase64(senderNonce), myPublicKey, mySecretKey);
    return d ? encodeUTF8(d) : null;
  } catch { return null; }
}

export const b64 = { encode: encodeBase64, decode: decodeBase64 };
