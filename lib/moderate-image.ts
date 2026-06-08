import { supabase } from "./supabase";

export type ModerationResult =
  | { ok: true; publishedUrl?: string }
  | { ok: false; message: string; pendingReview?: boolean };

const IS_PROD =
  process.env.EXPO_PUBLIC_IS_PRODUCTION === "true" ||
  process.env.NODE_ENV === "production";

export async function moderateImage(params: {
  imageUrl:   string;
  bucket:     string;
  path:       string;
  recordType: "avatar" | "post" | "score_proof" | "team_photo";
  recordId:   string;
  publishToBucket?: string;
  publishToPath?: string;
  contentType?: string;
}): Promise<ModerationResult> {
  try {
    const { data, error } = await supabase.functions.invoke("moderate-image", {
      body: {
        image_url:   params.imageUrl,
        bucket:      params.bucket,
        path:        params.path,
        record_type: params.recordType,
        record_id:   params.recordId,
        publish_to_bucket: params.publishToBucket,
        publish_to_path:   params.publishToPath,
        content_type:      params.contentType,
      },
    });
    if (error || !data) {
      return IS_PROD
        ? { ok: false, message: "Image moderation is temporarily unavailable. Please try again.", pendingReview: true }
        : { ok: true };
    }
    if (data.flagged) return { ok: false, message: data.message };
    if (data.pending_review) {
      return { ok: false, message: data.message ?? "Image is pending review.", pendingReview: true };
    }
    return { ok: true, publishedUrl: data.published_url };
  } catch {
    return IS_PROD
      ? { ok: false, message: "Image moderation is temporarily unavailable. Please try again.", pendingReview: true }
      : { ok: true };
  }
}
