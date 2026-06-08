import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { handleCorsPreflight, applyCors, rejectDisallowedOrigin } from "./_cors";
import { checkRateLimit, getClientIp } from "./_ratelimit";
import { logSecurityEvent } from "./_security-log";
import { validatePasswordStrength } from "../lib/validation";

const supabase = createClient(
  (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL)!,
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

function parseBody(body: unknown): Record<string, unknown> {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof body === "object" ? body as Record<string, unknown> : {};
}

async function logResetFailure(
  eventType: string,
  userId: string | null,
  details: Record<string, unknown>
) {
  await logSecurityEvent(supabase, eventType, "warn", userId, details);
}

function genericResetError(res: VercelResponse, status = 400) {
  return res.status(status).json({ error: "password_reset_failed" });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCorsPreflight(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");
  if (rejectDisallowedOrigin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!(await checkRateLimit(req, res))) return;

  try {
    const token = (req.headers.authorization ?? "").replace("Bearer ", "").trim();
    if (!token) {
      await logResetFailure("password_reset_missing_token", null, { ip: getClientIp(req) });
      return genericResetError(res, 401);
    }

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      await logResetFailure("password_reset_invalid_token", null, { ip: getClientIp(req) });
      return genericResetError(res, 401);
    }

    // Only allow calls from a recovery session (AMR method = "otp" = email link click)
    const claims = decodeJwt(token);
    const amr = (claims.amr ?? []) as { method: string; timestamp: number }[];
    const isRecoverySession = amr.some(a => a.method === "otp");
    if (!isRecoverySession) {
      await logResetFailure("password_reset_non_recovery_session", user.id, { ip: getClientIp(req) });
      return genericResetError(res, 403);
    }

    const body = parseBody(req.body);
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();
    const passwordCheck = validatePasswordStrength(body.password, {
      email: user.email,
      username: profile?.username ?? null,
    });
    if (!passwordCheck.ok) {
      await logResetFailure("password_reset_weak_password", user.id, { ip: getClientIp(req) });
      return genericResetError(res, 400);
    }

    const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, { password: passwordCheck.value });
    if (updateErr) {
      console.error("[password-reset] update failed", updateErr.message);
      await logResetFailure("password_reset_update_failed", user.id, { ip: getClientIp(req) });
      return genericResetError(res, 400);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[password-reset]", err);
    await logResetFailure("password_reset_exception", null, { ip: getClientIp(req) });
    return genericResetError(res, 500);
  }
}
