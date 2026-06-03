import { Platform } from "react-native";

export type SquareFoodItem = {
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

export type SquareCartItem = {
  name: string;
  price: number;
  quantity: number;
  squareVariationId?: string;
};

function getApiUrl(path: string) {
  if (Platform.OS === "web") return path;

  const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? process.env.EXPO_PUBLIC_SITE_URL;
  if (!baseUrl) {
    throw new Error("Missing EXPO_PUBLIC_API_BASE_URL or EXPO_PUBLIC_SITE_URL for native Square API calls.");
  }

  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export async function fetchSquareMenu(locationSlug: string) {
  const response = await fetch(getApiUrl(`/api/square/menu?location=${encodeURIComponent(locationSlug)}`));
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error ?? "Unable to load Square menu.");
  }

  return data as {
    configured: boolean;
    items: SquareFoodItem[];
    missing?: string[];
  };
}

export async function createSquareCheckoutLink(input: {
  locationSlug: string;
  localOrderId: string;
  tableNumber?: string;
  instructions?: string;
  items: SquareCartItem[];
}) {
  const response = await fetch(getApiUrl("/api/square/orders"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error ?? "Unable to create Square checkout.");
  }

  return data as {
    referenceId: string;
    squareOrderId: string | null;
    paymentLinkId: string | null;
    checkoutUrl: string | null;
    paymentLink: unknown;
  };
}
