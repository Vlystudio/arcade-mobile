import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { applyCors, handleCorsPreflight } from "../_cors";
import { assertSquareConfigured, squareRequest, getSquareLocationId } from "./_shared";

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

  const object = event?.data?.object;
  const eventPayment = object?.payment;
  const orderId = eventPayment?.order_id ?? object?.order_updated?.order_id ?? object?.order_created?.order_id ?? object?.order?.id;
  if (typeof orderId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(orderId)) {
    return res.status(202).json({ ok: true, ignored: true });
  }
  const square = assertSquareConfigured("arcade_bar");
  if (!square.configured) return res.status(503).json({ error: "webhook_unavailable" });
  try {
    // Reconcile against the current provider state; event delivery can be out of order.
    const { order } = await squareRequest(`/v2/orders/${encodeURIComponent(orderId)}`, square);
    if (!order || order.id !== orderId) throw new Error("order_not_found");
    const locations = [getSquareLocationId("arcade_bar"), getSquareLocationId("vinyl_hall")].filter(Boolean);
    if (!locations.includes(order.location_id)) return res.status(202).json({ ok: true, ignored: true });
    const { location } = await squareRequest(`/v2/locations/${encodeURIComponent(order.location_id)}`, square);
    if (!location?.merchant_id || event.merchant_id !== location.merchant_id) {
      return res.status(403).json({ error: "merchant_mismatch" });
    }
    const paymentIds = [...new Set<string>([
      ...(eventPayment?.id ? [eventPayment.id] : []),
      ...(order.tenders ?? []).map((t: any) => t.payment_id).filter(Boolean),
    ])];
    const payments = await Promise.all(paymentIds.map(async (id) => {
      const { payment } = await squareRequest(`/v2/payments/${encodeURIComponent(id)}`, square);
      if (!payment || payment.order_id !== orderId || payment.location_id !== order.location_id) throw new Error("payment_mismatch");
      return payment;
    }));
    const currency = order.total_money?.currency;
    const amount = order.total_money?.amount;
    const paid = payments.filter((p) => p.status === "COMPLETED" && p.amount_money?.currency === currency)
      .reduce((sum, p) => sum + (p.amount_money?.amount ?? 0) - (p.refunded_money?.amount ?? 0), 0);
    const verifiedPaid = Number.isSafeInteger(amount) && amount > 0 && paid >= amount;
    const { data, error } = await supabase.rpc("process_square_webhook", {
      p_event: event, p_order: order,
      p_payment: payments.find((p) => p.status === "COMPLETED") ?? payments[0] ?? null,
      p_verified_paid: verifiedPaid,
    });
    if (error || data?.error) throw new Error(error?.message ?? data.error);
    return res.status(200).json(data ?? { ok: true });
  } catch (error) {
    console.error("[square-webhook] reconciliation failed", error instanceof Error ? error.message : "unknown");
    // No event is marked processed until the database transaction commits all effects.
    return res.status(500).json({ error: "webhook_failed" });
  }
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
