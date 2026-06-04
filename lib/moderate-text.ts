import { supabase } from "./supabase";

export type TextModerationResult =
  | { ok: true }
  | { ok: false; message: string };

export async function moderateText(text: string): Promise<TextModerationResult> {
  if (!text?.trim()) return { ok: true };
  try {
    const { data, error } = await supabase.functions.invoke("moderate-text", {
      body: { text },
    });
    if (error || !data) return { ok: true }; // fail open
    if (data.flagged) return { ok: false, message: data.reason ?? "Your message was flagged by our content filter." };
    return { ok: true };
  } catch {
    return { ok: true }; // fail open
  }
}
