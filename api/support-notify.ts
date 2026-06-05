import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPPORT_FROM   = process.env.SUPPORT_FROM_EMAIL  ?? "ArcadeTracker <noreply@vlystudios.com>";
const SUPPORT_TO     = process.env.SUPPORT_NOTIFY_EMAIL ?? "valeyardvisuals@gmail.com";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  // Verify caller is an authenticated Supabase user
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return res.status(401).json({ error: "unauthorized" });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "unauthorized" });

  const { ticketId } = req.body ?? {};
  if (!ticketId) return res.status(400).json({ error: "missing_ticket_id" });

  // Fetch ticket and user profile
  const { data: ticket } = await supabase
    .from("support_tickets")
    .select("id, created_at, user_id")
    .eq("id", ticketId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!ticket) return res.status(404).json({ error: "ticket_not_found" });

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  const { data: firstMsg } = await supabase
    .from("support_messages")
    .select("content")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const username = profile?.username ?? user.email ?? "Unknown user";
  const preview  = firstMsg?.content ?? "(no message content)";

  // Mark ticket email as sent
  await supabase
    .from("support_tickets")
    .update({ email_sent: true })
    .eq("id", ticketId);

  if (!RESEND_API_KEY) {
    console.warn("[support-notify] RESEND_API_KEY not configured — ticket saved, no email sent.", {
      ticketId,
      username,
    });
    return res.status(200).json({ ok: true, email_sent: false, reason: "no_email_provider" });
  }

  const emailBody = [
    `URGENT SUPPORT REQUEST — ArcadeTracker`,
    ``,
    `User: ${username} (${user.email})`,
    `Ticket ID: ${ticketId}`,
    `Time: ${new Date(ticket.created_at).toLocaleString()}`,
    ``,
    `Message:`,
    preview,
    ``,
    `Reply directly to this user via the Admin panel → Support Tickets.`,
  ].join("\n");

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: SUPPORT_FROM,
        to:   [SUPPORT_TO],
        subject: `[URGENT] Support request from ${username}`,
        text: emailBody,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      console.error("[support-notify] Resend error:", detail);
      return res.status(200).json({ ok: true, email_sent: false, reason: "resend_error" });
    }
  } catch (err) {
    console.error("[support-notify] Failed to send email:", err);
    return res.status(200).json({ ok: true, email_sent: false, reason: "network_error" });
  }

  return res.status(200).json({ ok: true, email_sent: true });
}
