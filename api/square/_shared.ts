type SquareConfig = {
  accessToken: string;
  apiBaseUrl: string;
  locationId: string;
  squareVersion: string;
};

export type NormalizedSquareMenuItem = {
  id: string;
  source: "square";
  squareVariationId: string;
  squareItemId: string;
  name: string;
  description: string | null;
  price: number;
  category: string;
  ingredients: string[];
  photo_url: string | null;
  available: boolean;
};

export function sendJson(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function getSquareLocationId(locationSlug: string) {
  const envName = `SQUARE_LOCATION_${locationSlug.toUpperCase()}_ID`;
  const direct = process.env[envName];
  if (direct) return direct;

  const map = process.env.SQUARE_LOCATION_IDS;
  if (!map) return process.env.SQUARE_LOCATION_ID;

  try {
    const parsed = JSON.parse(map) as Record<string, string>;
    return parsed[locationSlug] ?? process.env.SQUARE_LOCATION_ID;
  } catch {
    return process.env.SQUARE_LOCATION_ID;
  }
}

export function assertSquareConfigured(locationSlug: string) {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = getSquareLocationId(locationSlug);
  const squareVersion = process.env.SQUARE_VERSION ?? "2026-05-20";
  const apiBaseUrl = getSquareApiBaseUrl();

  if (!accessToken || !locationId) {
    return {
      configured: false as const,
      missing: [
        !accessToken ? "SQUARE_ACCESS_TOKEN" : null,
        !locationId ? `SQUARE_LOCATION_${locationSlug.toUpperCase()}_ID` : null,
      ].filter(Boolean),
    };
  }

  return { configured: true as const, accessToken, locationId, squareVersion, apiBaseUrl };
}

export async function squareRequest(path: string, config: SquareConfig, init: RequestInit = {}) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Square-Version": config.squareVersion,
      Authorization: `Bearer ${config.accessToken}`,
      ...(init.headers ?? {}),
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getSquareErrorMessage(data, `Square request failed with status ${response.status}.`));
  }

  return data;
}

export async function fetchSquareCategories(config: SquareConfig) {
  const categories = new Map<string, string>();
  let cursor: string | undefined;

  do {
    const query = new URLSearchParams({ types: "CATEGORY" });
    if (cursor) query.set("cursor", cursor);

    const data = await squareRequest(`/v2/catalog/list?${query.toString()}`, config);
    for (const object of data?.objects ?? []) {
      if (object?.id && object?.category_data?.name) {
        categories.set(object.id, object.category_data.name);
      }
    }
    cursor = data?.cursor;
  } while (cursor);

  return categories;
}

export function normalizeSquareCatalogItems(items: any[], categories: Map<string, string>) {
  const normalized: NormalizedSquareMenuItem[] = [];

  for (const item of items ?? []) {
    if (item?.type !== "ITEM" || item?.is_deleted || item?.item_data?.is_archived) continue;

    const itemData = item.item_data ?? {};
    const categoryId = itemData.category_id ?? itemData.categories?.[0]?.id;
    const category = normalizeCategory(categories.get(categoryId) ?? itemData.reporting_category?.name ?? itemData.name);

    for (const variation of itemData.variations ?? []) {
      const variationData = variation?.item_variation_data ?? {};
      const amount = variationData?.price_money?.amount;
      if (!variation?.id || typeof amount !== "number") continue;

      const variationName = variationData.name && variationData.name !== "Regular" ? ` (${variationData.name})` : "";
      normalized.push({
        id: `square:${variation.id}`,
        source: "square",
        squareVariationId: variation.id,
        squareItemId: item.id,
        name: `${itemData.name ?? "Menu item"}${variationName}`,
        description: itemData.description ?? null,
        price: amount / 100,
        category,
        ingredients: [],
        photo_url: null,
        available: !variation.is_deleted && !variationData?.is_archived,
      });
    }
  }

  return normalized;
}

function getSquareApiBaseUrl() {
  if (process.env.SQUARE_API_BASE_URL) return process.env.SQUARE_API_BASE_URL.replace(/\/+$/, "");
  return process.env.SQUARE_ENVIRONMENT === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

function normalizeCategory(name: string | undefined) {
  const lower = (name ?? "menu").trim().toLowerCase();

  if (lower.includes("starter") || lower.includes("appetizer") || lower.includes("share")) return "appetizers";
  if (lower.includes("burger") || lower.includes("sandwich")) return "burgers";
  if (lower.includes("pizza") || lower.includes("flatbread")) return "pizza";
  if (lower.includes("drink") || lower.includes("beer") || lower.includes("wine") || lower.includes("cocktail")) return "drinks";
  if (lower.includes("dessert") || lower.includes("sweet")) return "desserts";
  if (lower.includes("main") || lower.includes("entree") || lower.includes("plate")) return "mains";

  return lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "menu";
}

function getSquareErrorMessage(data: any, fallback: string) {
  const firstError = data?.errors?.[0];
  return firstError?.detail ?? firstError?.code ?? data?.message ?? fallback;
}
