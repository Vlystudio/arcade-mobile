import { supabase } from "./supabase";

export type ModerationResult =
  | { ok: true }
  | { ok: false; message: string };

export async function moderateImage(params: {
  imageUrl:   string;
  bucket:     string;
  path:       string;
  recordType: "avatar" | "post" | "score_proof";
  recordId:   string;
}): Promise<ModerationResult> {
  try {
    const { data, error } = await supabase.functions.invoke("moderate-image", {
      body: {
        image_url:   params.imageUrl,
        bucket:      params.bucket,
        path:        params.path,
        record_type: params.recordType,
        record_id:   params.recordId,
      },
    });
    // Fail open: if the function errors, allow the upload through
    if (error || !data) return { ok: true };
    if (data.flagged) return { ok: false, message: data.message };
    return { ok: true };
  } catch {
    return { ok: true }; // fail open on network errors
  }
}
