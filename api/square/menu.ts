import { checkRateLimit } from "../_ratelimit";
import { applyCors, handleCorsPreflight, rejectDisallowedOrigin } from "../_cors";
import { assertSquareConfigured, fetchSquareCategories, normalizeSquareCatalogItems, sendJson, squareRequest } from "./_shared";

export default async function handler(req: any, res: any) {
  if (handleCorsPreflight(req, res, "GET, OPTIONS")) return;
  applyCors(req, res, "GET, OPTIONS");
  if (rejectDisallowedOrigin(req, res)) return;

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
    const imageIds: string[] = [...new Set<string>(items.flatMap(item => [
      ...(item.item_data?.image_ids ?? []),
      ...(item.item_data?.variations ?? []).flatMap((v: any) => v.item_variation_data?.image_ids ?? []),
    ]))];
    const images = new Map<string, string>();
    // Photos are optional: a catalog-image outage must not take down ordering.
    try {
      for (let i = 0; i < imageIds.length; i += 1000) {
        const data = await squareRequest("/v2/catalog/batch-retrieve", config, { method: "POST", body: JSON.stringify({ object_ids: imageIds.slice(i, i + 1000) }) });
        for (const object of data.objects ?? []) {
          if (object.type === "IMAGE" && !object.is_deleted && typeof object.image_data?.url === "string" && object.image_data.url.startsWith("https://")) images.set(object.id, object.image_data.url);
        }
      }
    } catch { console.warn("[square-menu] Catalog images unavailable"); }

    return sendJson(res, 200, {
      configured: true,
      items: normalizeSquareCatalogItems(items, categories, images),
    });
  } catch (error: any) {
    console.error("[square-menu] load failed", error?.message ?? error);
    return sendJson(res, 502, {
      error: "Unable to load Square menu.",
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
