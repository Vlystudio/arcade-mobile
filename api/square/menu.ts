import { checkRateLimit } from "../_ratelimit";
import { assertSquareConfigured, fetchSquareCategories, normalizeSquareCatalogItems, sendJson, squareRequest } from "./_shared";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (!(await checkRateLimit(req, res))) return;

  const locationSlug = String(req.query?.location ?? "arcade_bar");
  const config = assertSquareConfigured(locationSlug);

  if (!config.configured) {
    return sendJson(res, 200, {
      configured: false,
      items: [],
      missing: config.missing,
    });
  }

  try {
    const [items, categories] = await Promise.all([
      fetchAllSquareItems(config),
      fetchSquareCategories(config),
    ]);

    return sendJson(res, 200, {
      configured: true,
      items: normalizeSquareCatalogItems(items, categories),
    });
  } catch (error: any) {
    return sendJson(res, 502, {
      error: error?.message ?? "Unable to load Square menu.",
    });
  }
}

async function fetchAllSquareItems(config: any) {
  const items: any[] = [];
  let cursor: string | undefined;

  do {
    const data = await squareRequest("/v2/catalog/search-catalog-items", config, {
      method: "POST",
      body: JSON.stringify({
        enabled_location_ids: [config.locationId],
        product_types: ["REGULAR"],
        archived_state: "ARCHIVED_STATE_NOT_ARCHIVED",
        sort_order: "ASC",
        limit: 100,
        ...(cursor ? { cursor } : {}),
      }),
    });

    items.push(...(data?.items ?? []));
    cursor = data?.cursor;
  } while (cursor);

  return items;
}
