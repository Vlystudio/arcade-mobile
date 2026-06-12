import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { applyCors, handleCorsPreflight } from "../_cors";

const supabase = createClient(
  (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_EVENT_TYPES = new Set([
  "payment.created",
  "payment.updated",
  "order.created",
  "order.updated",
]);

// Square signs the EXACT raw request bytes (notification URL + body).
// Vercel's default body parser consumes the stream and re-serializing the
// parsed object does not reproduce those bytes (whitespace, unicode escapes,
// number formatting), which breaks — or worse, weakens — HMAC verification.
// Disable parsing so we always verify against the untouched raw body.
export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCorsPreflight(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;
  if (!signatureKey || !notificationUrl) {
    console.error("[square-webhook] missing webhook signature configuration");
    return res.status(503).json({ error: "webhook_unavailable" });
  }

  let rawBody: string;
  try {
    rawBody = await readRawBody(req);
  } catch (e: any) {
    console.error("[square-webhook] raw body read failed:", e?.message);
    return res.status(500).json({ error: "webhook_failed" });
  }
  const signature = req.headers["x-square-hmacsha256-signature"];
  if (typeof signature !== "string" || !verifySquareSignature(rawBody, signature, signatureKey, notificationUrl)) {
    console.warn("[square-webhook] invalid signature");
    // Log security event (fire-and-forget; do not block the 401 response)
    logPaymentSecurityEvent("payment_webhook_invalid_sig", { endpoint: req.url });
    return res.status(401).json({ error: "unauthorized" });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "invalid_payload" });
  }

  const eventId = String(event?.event_id ?? event?.id ?? "");
  const eventType = String(event?.type ?? "");
  if (!eventId || !ALLOWED_EVENT_TYPES.has(eventType)) {
    return res.status(202).json({ ok: true, ignored: true });
  }

  const { error: eventError } = await supabase.from("square_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
    merchant_id: event?.merchant_id ?? null,
    payload: event,
  });

  if (eventError) {
    if (eventError.code === "23505") {
      // Duplicate event_id — log as replay attempt (fire-and-forget)
      logPaymentSecurityEvent("payment_webhook_replay", { event_id: eventId });
      return res.status(200).json({ ok: true, duplicate: true });
    }
    console.error("[square-webhook] event insert failed", eventError.message);
    return res.status(500).json({ error: "webhook_failed" });
  }

  const payment = event?.data?.object?.payment;
  const order = event?.data?.object?.order;
  const paymentId = payment?.id ?? null;
  const orderId = payment?.order_id ?? order?.id ?? null;
  const status = payment?.status ?? order?.state ?? null;

  if (paymentId || orderId) {
    const matchColumn = paymentId ? "square_payment_id" : "square_order_id";
    const matchValue = paymentId ?? orderId;
    const statusPayload = {
      square_payment_id: paymentId,
      square_order_id: orderId,
      status,
      event_type: eventType,
      last_event_id: eventId,
      updated_at: new Date().toISOString(),
      raw_event: event,
    };

    const { data: existing, error: lookupError } = await supabase
      .from("square_payment_statuses")
      .select("id")
      .eq(matchColumn, matchValue)
      .maybeSingle();
    if (lookupError) {
      console.error("[square-webhook] status lookup failed", lookupError.message);
      return res.status(500).json({ error: "webhook_failed" });
    }

    const { error: statusError } = existing?.id
      ? await supabase.from("square_payment_statuses").update(statusPayload).eq("id", existing.id)
      : await supabase.from("square_payment_statuses").insert(statusPayload);

    if (statusError) {
      console.error("[square-webhook] status upsert failed", statusError.message);
      return res.status(500).json({ error: "webhook_failed" });
    }
  }

  // Auto-confirm team registration payments when the order completes
  const orderReferenceId: string | null = order?.reference_id ?? null;
  const isOrderComplete = order?.state === "COMPLETED" || payment?.status === "COMPLETED";
  if (orderReferenceId?.startsWith("reg:") && isOrderComplete) {
    const registrationId = orderReferenceId.slice(4);
    const { error: regError } = await supabase
      .from("team_registrations")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        ...(orderId ? { square_order_id: orderId } : {}),
      })
      .eq("id", registrationId)
      .eq("status", "pending_payment");
    if (regError) {
      console.error("[square-webhook] registration confirm failed", regError.message);
    }
  }

  return res.status(200).json({ ok: true });
}

function logPaymentSecurityEvent(eventType: string, details: Record<string, unknown>) {
  void (async () => {
    try {
      await supabase.rpc("log_payment_security_event", {
        p_event_type: eventType,
        p_details: details,
      });
    } catch {
      // Best-effort security logging must not change webhook response semantics.
    }
  })();
}

async function readRawBody(req: VercelRequest): Promise<string> {
  // bodyParser is disabled for this route (see config above), so the normal
  // path is the stream read. The string/Buffer branches only cover runtimes
  // that hand us the raw payload directly.
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") {
    // A parsed object means the raw bytes are gone — re-serialization is NOT
    // byte-faithful, so verification against it would be unsound. Fail closed.
    throw new Error("raw body unavailable: body was parsed before the handler");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function verifySquareSignature(
  rawBody: string,
  signature: string,
  signatureKey: string,
  notificationUrl: string
) {
  const expected = crypto
    .createHmac("sha256", signatureKey)
    .update(`${notificationUrl}${rawBody}`, "utf8")
    .digest("base64");

  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}
