import { supabase } from "./supabase";
const PREFIX = "storage://message-media/";
export const messageImageReference = (path: string) => PREFIX + path;
export function messageImagePath(value: string, conversationId: string): string | null {
  let path: string;
  if (value.startsWith(PREFIX)) path = value.slice(PREFIX.length);
  else {
    // Migrate old same-project public URLs at read time, still enforcing private RLS.
    try {
      const url = new URL(value);
      if (url.origin !== new URL(process.env.EXPO_PUBLIC_SUPABASE_URL!).origin) return null;
      const prefix = "/storage/v1/object/public/message-media/";
      if (!url.pathname.startsWith(prefix)) return null;
      path = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch { return null; }
  }
  const parts = path.split("/");
  if (parts.length !== 3 || parts[0] !== conversationId || parts.some((p) => !/^[a-zA-Z0-9._-]+$/.test(p) || p === "." || p === "..")) return null;
  return path;
}
export async function resolveMessageImage(value: string | null | undefined, conversationId: string) {
  if (!value) return null;
  const path = messageImagePath(value, conversationId);
  if (!path) return null;
  const { data, error } = await supabase.storage.from("message-media").createSignedUrl(path, 3600);
  return error ? null : data?.signedUrl ?? null;
}
