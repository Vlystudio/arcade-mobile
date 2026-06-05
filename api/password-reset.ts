import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function decodeJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const token = (req.headers.authorization ?? "").replace("Bearer ", "").trim();
  if (!token) return res.status(401).json({ error: "unauthorized" });

  // Verify the token is valid
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "unauthorized" });

  // Only allow calls from a recovery session (AMR method = "otp" = email link click)
  const claims = decodeJwt(token);
  const amr = (claims.amr ?? []) as { method: string; timestamp: number }[];
  const isRecoverySession = amr.some(a => a.method === "otp");
  if (!isRecoverySession) {
    return res.status(403).json({ error: "not_a_recovery_session" });
  }

  const { password } = req.body ?? {};
  if (!password || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "password_too_short" });
  }

  // Admin update bypasses AAL2 requirement — safe here because we verified
  // this is a legitimate email recovery session (OTP amr claim)
  const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, { password });
  if (updateErr) return res.status(400).json({ error: updateErr.message });

  return res.status(200).json({ ok: true });
}
