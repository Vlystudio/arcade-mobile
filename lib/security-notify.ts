import { supabase } from "./supabase";
import { API_BASE } from "./api-base";

export async function sendSecurityAlert(
  event: "password_changed" | "mfa_added" | "mfa_removed"
) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch(`${API_BASE}/api/security-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ event }),
    });
  } catch {
    // Non-fatal — do not block the user action
  }
}
