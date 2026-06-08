import { checkRateLimit } from "../_ratelimit";
import { applyCors, handleCorsPreflight, rejectDisallowedOrigin } from "../_cors";
import { assertSquareConfigured, sendJson, squareRequest } from "./_shared";
import { validateFoodInstructions, validateTableNumber } from "../../lib/validation";

type SquareOrderItem = {
  squareVariationId: string;
  quantity: number;
};

export default async function handler(req: any, res: any) {
  if (handleCorsPreflight(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");
  if (rejectDisallowedOrigin(req, res)) return;

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (!(await checkRateLimit(req, res))) return;

  const body = parseJsonBody(req.body);
  if (!body) {
    return sendJson(res, 400, { error: "Invalid order request." });
  }
  const locationSlug = String(body?.locationSlug ?? "arcade_bar");
  const config = assertSquareConfigured(locationSlug);

  if (!config.configured) {
    return sendJson(res, 503, {
      error: "Square is not configured for this location.",
      missing: config.missing,
    });
  }

  const items = Array.isArray(body?.items) ? body.items as SquareOrderItem[] : [];
  if (!items.length) {
    return sendJson(res, 400, { error: "Order must include at least one item." });
  }

  const tableCheck = validateTableNumber(body?.tableNumber);
  const instructionCheck = validateFoodInstructions(body?.instructions);
  if (!tableCheck.ok || !instructionCheck.ok) {
    return sendJson(res, 400, { error: "Invalid order details." });
  }

  // Validate quantity bounds (client must not send 0 or absurdly large quantities)
  for (const item of items) {
    const qty = Number(item.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      return sendJson(res, 400, {
        error: "Each item quantity must be a whole number between 1 and 50.",
      });
    }
  }

  // Reject any item that lacks a Square catalog variation ID.
  // Custom name+price from the client is a server-side price manipulation risk.
  const nonCatalogItem = items.find((item) => !item.squareVariationId);
  if (nonCatalogItem) {
    return sendJson(res, 400, {
      error: "Each item must include a Square variation ID. Custom-priced items are not accepted.",
    });
  }

  // Validate all variation IDs against the Square Catalog API.
  // This prevents fake/spoofed variation IDs from reaching the checkout link.
  const variationIds = [...new Set(items.map((i) => i.squareVariationId))];
  let catalogObjects: Map<string, any>;
  try {
    catalogObjects = await fetchCatalogVariations(variationIds, config);
  } catch (err: any) {
    return sendJson(res, 502, {
      error: "Unable to verify menu items with Square. Please try again.",
    });
  }

  // Each variation must exist, be active, and belong to this location
  for (const item of items) {
    const obj = catalogObjects.get(item.squareVariationId);
    if (!obj) {
      return sendJson(res, 400, {
        error: "A selected item is not available.",
      });
    }
    if (obj.is_deleted) {
      return sendJson(res, 400, {
        error: `A selected item is no longer available.`,
      });
    }
    const variationData = obj.item_variation_data ?? {};
    if (variationData.sold_out) {
      return sendJson(res, 400, {
        error: `A selected item is currently sold out.`,
      });
    }
    // Verify the variation is available at this location
    if (
      variationData.location_overrides?.some(
        (o: any) => o.location_id === config.locationId && o.sold_out
      )
    ) {
      return sendJson(res, 400, {
        error: `A selected item is sold out at this location.`,
      });
    }
  }

  const localOrderId = body?.localOrderId ?? createUuid();
  const externalPrefix = process.env.SQUARE_REFERENCE_PREFIX ?? "arcadetracker";
  const referenceId = `${externalPrefix}:${localOrderId}`.slice(0, 40);
  const note = buildOrderNote(tableCheck.value, instructionCheck.value);

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
          table_or_lane: tableCheck.value || undefined,
        }).filter(([, v]) => v !== undefined && v !== "")
      ),
      // Prices come entirely from Square's catalog — client quantity only.
      line_items: items.map((item) => ({
        catalog_object_id: item.squareVariationId,
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
    console.error("[square-orders] checkout link failed", error?.message ?? error);
    return sendJson(res, 502, {
      error: "Unable to create Square checkout. Please try again.",
    });
  }
}

function parseJsonBody(body: unknown): Record<string, any> | null {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof body === "object" ? body as Record<string, any> : null;
}

/**
 * Fetch catalog ITEM_VARIATION objects from Square by their IDs.
 * Returns a Map<variationId, catalogObject>.
 * Only ITEM_VARIATION type is relevant for order line items.
 */
async function fetchCatalogVariations(
  variationIds: string[],
  config: Parameters<typeof squareRequest>[1]
): Promise<Map<string, any>> {
  const result = await squareRequest("/v2/catalog/batch-retrieve", config, {
    method: "POST",
    body: JSON.stringify({
      object_ids: variationIds,
      include_related_objects: false,
    }),
  });

  const map = new Map<string, any>();
  for (const obj of result?.objects ?? []) {
    if (obj?.id && obj?.type === "ITEM_VARIATION") {
      map.set(obj.id, obj);
    }
  }
  return map;
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
