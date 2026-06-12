import { createClient } from "@supabase/supabase-js";
import { applyCors, handleCorsPreflight, rejectDisallowedOrigin } from "../_cors";
import { checkRateLimit } from "../_ratelimit";
import { assertSquareConfigured, sendJson, squareRequest } from "./_shared";

const supabase = createClient(
  (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: any, res: any) {
  if (handleCorsPreflight(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");
  if (rejectDisallowedOrigin(req, res)) return;

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (!(await checkRateLimit(req, res))) return;

  const body = parseBody(req.body);
  const registrationId = typeof body?.registrationId === "string" ? body.registrationId.trim() : null;
  if (!registrationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(registrationId)) {
    return sendJson(res, 400, { error: "Invalid registration ID." });
  }

  // Look up registration + season via service role
  const { data: reg, error: regError } = await supabase
    .from("team_registrations")
    .select("id, user_id, registration_type, status, seasons(id, name, team_fee_cents, individual_fee_cents, registration_required)")
    .eq("id", registrationId)
    .maybeSingle();

  if (regError || !reg) {
    return sendJson(res, 404, { error: "Registration not found." });
  }
  if (reg.status !== "pending_payment") {
    return sendJson(res, 400, { error: "Registration is not awaiting payment." });
  }

  const season: any = Array.isArray((reg as any).seasons) ? (reg as any).seasons[0] : (reg as any).seasons;
  if (!season?.registration_required) {
    return sendJson(res, 400, { error: "This season does not require paid registration." });
  }

  const config = assertSquareConfigured("arcade_bar");
  if (!config.configured) {
    return sendJson(res, 503, { error: "Payment system is not configured. Please try again later." });
  }

  const amountCents: number = reg.registration_type === "team"
    ? (season.team_fee_cents ?? 20000)
    : (season.individual_fee_cents ?? 5000);

  const displayName = reg.registration_type === "team"
    ? `Team Registration — ${season.name}`
    : `Individual Registration — ${season.name}`;

  const siteUrl = (process.env.EXPO_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  const redirectUrl = siteUrl ? `${siteUrl}/teams?reg=${registrationId}&status=complete` : undefined;

  const payload: any = {
    idempotency_key: `reg-${registrationId}`,
    description: displayName,
    order: {
      location_id: config.locationId,
      reference_id: `reg:${registrationId}`,
      source: { name: "ArcadeTracker" },
      line_items: [
        {
          name: displayName,
          quantity: "1",
          base_price_money: { amount: amountCents, currency: "USD" },
        },
      ],
    },
    checkout_options: {
      ask_for_shipping_address: false,
      allow_tipping: false,
      ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
    },
  };

  try {
    const result = await squareRequest("/v2/online-checkout/payment-links", config, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const paymentLinkId: string | null = result?.payment_link?.id ?? null;
    const checkoutUrl: string | null = result?.payment_link?.url ?? null;
    const squareOrderId: string | null = result?.payment_link?.order_id ?? null;

    await supabase.from("team_registrations").update({
      square_payment_link_id: paymentLinkId,
      square_order_id: squareOrderId,
      checkout_url: checkoutUrl,
    }).eq("id", registrationId);

    return sendJson(res, 200, { checkoutUrl, paymentLinkId, squareOrderId });
  } catch (err: any) {
    console.error("[square-registration] payment link failed", err?.message ?? err);
    return sendJson(res, 502, { error: "Unable to create payment link. Please try again." });
  }
}

function parseBody(body: unknown): Record<string, any> | null {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch { return null; }
  }
  return typeof body === "object" ? (body as Record<string, any>) : null;
}
