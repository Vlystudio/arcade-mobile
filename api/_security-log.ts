import type { SupabaseClient } from "@supabase/supabase-js";

export async function logSecurityEvent(
  supabase: SupabaseClient,
  eventType: string,
  severity: "info" | "warn" | "critical",
  userId: string | null,
  details: Record<string, unknown> = {}
) {
  try {
    await supabase.from("security_events").insert({
      event_type: eventType,
      severity,
      user_id: userId,
      details,
    });
  } catch (error) {
    console.warn("[security-events] failed to write event", error instanceof Error ? error.message : error);
  }
}
