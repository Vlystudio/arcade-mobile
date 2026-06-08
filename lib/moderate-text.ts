import { supabase } from "./supabase";

export type TextModerationResult =
  | { ok: true }
  | { ok: false; message: string };

const IS_PROD =
  process.env.EXPO_PUBLIC_IS_PRODUCTION === "true" ||
  process.env.NODE_ENV === "production";

export async function moderateText(text: string): Promise<TextModerationResult> {
  if (!text?.trim()) return { ok: true };
  try {
    const { data, error } = await supabase.functions.invoke("moderate-text", {
      body: { text },
    });
    if (error || !data) {
      return IS_PROD
        ? { ok: false, message: "Text moderation is temporarily unavailable. Please try again." }
        : { ok: true };
    }
    if (data.flagged) return { ok: false, message: data.reason ?? "Your message was flagged by our content filter." };
    if (data.pending_review) return { ok: false, message: data.message ?? "Content is pending review." };
    return { ok: true };
  } catch {
    return IS_PROD
      ? { ok: false, message: "Text moderation is temporarily unavailable. Please try again." }
      : { ok: true };
  }
}
