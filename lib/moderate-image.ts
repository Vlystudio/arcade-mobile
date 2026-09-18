import { supabase } from "./supabase";

export type ModerationResult =
  | { ok: true; publishedUrl?: string; publishedPath?: string }
  | { ok: false; message: string; pendingReview?: boolean };

export async function moderateImage(params: {
  bucket:     string;
  path:       string;
  recordType: "avatar" | "post" | "team_photo";
  recordId:   string;
  contentType?: string;
}): Promise<ModerationResult> {
  try {
    const { data, error } = await supabase.functions.invoke("moderate-image", {
      body: {
        bucket:      params.bucket,
        path:        params.path,
        record_type: params.recordType,
        record_id:   params.recordId,
        content_type:      params.contentType,
      },
    });
    if (error || !data) {
      return { ok: false, message: "Image moderation is temporarily unavailable. Please try again.", pendingReview: true };
    }
    if (data.flagged) return { ok: false, message: data.message };
    if (data.pending_review) {
      return { ok: false, message: data.message ?? "Image is pending review.", pendingReview: true };
    }
    if (data.ok !== true) return { ok: false, message: data.message ?? "Image could not be verified." };
    return { ok: true, publishedUrl: data.published_url, publishedPath: data.published_path };
  } catch {
    return { ok: false, message: "Image moderation is temporarily unavailable. Please try again.", pendingReview: true };
  }
}
