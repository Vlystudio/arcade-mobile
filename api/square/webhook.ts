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

  const rawBody = await readRawBody(req);
  const signature = req.headers["x-square-hmacsha256-signature"];
  if (typeof signature !== "string" || !verifySquareSignature(rawBody, signature, signatureKey, notificationUrl)) {
    console.warn("[square-webhook] invalid signature");
    // Log security event (fire-and-forget; do not block the 401 response)
    supabase.rpc("log_payment_security_event", {
      p_event_type: "payment_webhook_invalid_sig",
      p_details: { endpoint: req.url },
    }).catch(() => {});
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
      supabase.rpc("log_payment_security_event", {
        p_event_type: "payment_webhook_replay",
        p_details: { event_id: eventId },
      }).catch(() => {});
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

  return res.status(200).json({ ok: true });
}

async function readRawBody(req: VercelRequest): Promise<string> {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);

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
