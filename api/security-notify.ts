import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { applyCors, handleCorsPreflight, rejectDisallowedOrigin } from "./_cors";
import { checkRateLimit } from "./_ratelimit";

const supabase = createClient(
  (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.SUPPORT_FROM_EMAIL ?? "ArcadeTracker <noreply@vlystudios.com>";

const EVENTS = {
  password_changed: {
    subject: "Your ArcadeTracker password was changed",
    title:   "Password Changed",
    body:    "Your account password was just updated. If you made this change, no action is needed.\n\nIf you did NOT make this change, contact our support team immediately via the app.",
  },
  mfa_added: {
    subject: "Two-factor authentication enabled on your account",
    title:   "2FA Enabled",
    body:    "Two-factor authentication (2FA) has been added to your ArcadeTracker account. Your account is now more secure.\n\nIf you did NOT make this change, contact our support team immediately via the app.",
  },
  mfa_removed: {
    subject: "Two-factor authentication removed from your account",
    title:   "2FA Disabled",
    body:    "Two-factor authentication has been removed from your ArcadeTracker account.\n\nIf you did NOT make this change, contact our support team immediately via the app.",
  },
} as const;

type SecurityEvent = keyof typeof EVENTS;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCorsPreflight(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");
  if (rejectDisallowedOrigin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!(await checkRateLimit(req, res))) return;

  const token = (req.headers.authorization ?? "").replace("Bearer ", "").trim();
  if (!token) return res.status(401).json({ error: "unauthorized" });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "unauthorized" });

  const { event } = req.body ?? {};
  if (!event || !(event in EVENTS)) return res.status(400).json({ error: "invalid_event" });

  const userEmail = user.email;
  if (!userEmail) return res.status(200).json({ ok: true, sent: false, reason: "no_email" });

  if (!RESEND_API_KEY) {
    console.warn("[security-notify] RESEND_API_KEY not configured — skipping email");
    return res.status(200).json({ ok: true, sent: false, reason: "no_email_provider" });
  }

  const { subject, title, body } = EVENTS[event as SecurityEvent];

  const text = [
    `${title} — ArcadeTracker`,
    ``,
    body,
    ``,
    `Time:    ${new Date().toLocaleString()}`,
    `Account: ${userEmail}`,
  ].join("\n");

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [userEmail], subject, text }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      console.error("[security-notify] Resend error:", detail);
      return res.status(200).json({ ok: true, sent: false, reason: "resend_error" });
    }
  } catch (err) {
    console.error("[security-notify] fetch error:", err);
    return res.status(200).json({ ok: true, sent: false, reason: "network_error" });
  }

  return res.status(200).json({ ok: true, sent: true });
}
