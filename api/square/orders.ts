import { checkRateLimit } from "../_ratelimit";
import { assertSquareConfigured, sendJson, squareRequest } from "./_shared";

type SquareOrderItem = {
  name?: string;
  price?: number;
  quantity: number;
  squareVariationId?: string;
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (!(await checkRateLimit(req, res))) return;

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const locationSlug = String(body?.locationSlug ?? "arcade_bar");
  const config = assertSquareConfigured(locationSlug);

  if (!config.configured) {
    return sendJson(res, 503, {
      error: "Square is not configured for this location.",
      missing: config.missing,
    });
  }

  const items = (body?.items ?? []) as SquareOrderItem[];
  if (!items.length) {
    return sendJson(res, 400, { error: "Order must include at least one item." });
  }

  // Reject any item that doesn't have a Square catalog variation ID.
  // All real menu items sourced from the Square catalog always have squareVariationId.
  // Accepting custom name+price from the client is a server-side price manipulation risk.
  const nonCatalogItem = items.find((item) => !item.squareVariationId);
  if (nonCatalogItem) {
    return sendJson(res, 400, {
      error: "Each item must include a Square variation ID. Custom-priced items are not accepted.",
    });
  }

  const localOrderId = body?.localOrderId ?? createUuid();
  const externalPrefix = process.env.SQUARE_REFERENCE_PREFIX ?? "arcadetracker";
  const referenceId = `${externalPrefix}:${localOrderId}`.slice(0, 40);
  const note = buildOrderNote(body?.tableNumber, body?.instructions);

  const payload = {
    idempotency_key: localOrderId,
    description: `ArcadeTracker food order ${referenceId}`,
    checkout_options: {
      ask_for_shipping_address: false,
      allow_tipping: true,
      redirect_url: process.env.SQUARE_CHECKOUT_REDIRECT_URL ?? process.env.EXPO_PUBLIC_SITE_URL,
    },
    order: {
      location_id: config.locationId,
      reference_id: referenceId,
      source: { name: "ArcadeTracker" },
      metadata: Object.fromEntries(
        Object.entries({
          app_order_id: String(localOrderId).slice(0, 40),
          table_or_lane: String(body?.tableNumber ?? "").slice(0, 40) || undefined,
        }).filter(([, v]) => v !== undefined && v !== "")
      ),
      line_items: items.map((item) => ({
        ...(item.squareVariationId
          ? { catalog_object_id: item.squareVariationId }
          : {
              name: item.name,
              base_price_money: {
                amount: Math.round(Number(item.price) * 100),
                currency: process.env.SQUARE_CURRENCY ?? "USD",
              },
            }),
        quantity: String(Math.max(1, Number(item.quantity) || 1)),
        ...(note ? { note } : {}),
      })),
    },
  };

  try {
    const result = await squareRequest("/v2/online-checkout/payment-links", config, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return sendJson(res, 200, {
      referenceId,
      squareOrderId: result?.payment_link?.order_id ?? null,
      paymentLinkId: result?.payment_link?.id ?? null,
      checkoutUrl: result?.payment_link?.url ?? null,
      paymentLink: result?.payment_link ?? null,
    });
  } catch (error: any) {
    return sendJson(res, 502, {
      error: error?.message ?? "Unable to create Square checkout.",
    });
  }
}

function buildOrderNote(tableNumber?: string, instructions?: string) {
  const parts = [
    tableNumber ? `Deliver to ${tableNumber}` : null,
    instructions ? `Instructions: ${instructions}` : null,
  ].filter(Boolean);

  return parts.join(" | ").slice(0, 500);
}

function createUuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const nibble = char === "x" ? value : (value & 0x3) | 0x8;
    return nibble.toString(16);
  });
}
