import { supabase } from "./supabase";

export type ReportReason =
  | "inappropriate_picture"
  | "inappropriate_text"
  | "racism"
  | "violence"
  | "nudity"
  | "other";

export type ReportContentType = "post" | "comment";

export type ReportResult = { ok: true } | { ok: false; message: string };

export async function reportContent(
  contentType: ReportContentType,
  contentId: string,
  reason: ReportReason,
  details?: string
): Promise<ReportResult> {
  const { data, error } = await supabase.rpc("rpc_report_content", {
    p_content_type: contentType,
    p_content_id: contentId,
    p_reason: reason,
    p_details: details ?? null,
  });

  if (error) {
    return { ok: false, message: "Could not submit report. Please try again." };
  }

  switch (data?.error) {
    case undefined:
      return { ok: true };
    case "cannot_report_own_content":
      return { ok: false, message: "You can't report your own content." };
    case "not_found":
      return { ok: false, message: "This content no longer exists." };
    case "not_authenticated":
      return { ok: false, message: "Please sign in to report content." };
    default:
      return { ok: false, message: "Could not submit report. Please try again." };
  }
}
