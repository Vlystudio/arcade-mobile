const IS_PROD = Deno.env.get("IS_PRODUCTION") === "true";

function splitOrigins(value: string | null) {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin: string) {
  const withScheme = /^https?:\/\//i.test(origin) ? origin : `https://${origin}`;
  return withScheme.replace(/\/+$/, "");
}

function configuredOrigins() {
  return [
    Deno.env.get("EXPO_PUBLIC_SITE_URL"),
    Deno.env.get("VERCEL_PROJECT_PRODUCTION_URL"),
    Deno.env.get("VERCEL_URL"),
    Deno.env.get("VERCEL_BRANCH_URL"),
    ...splitOrigins(Deno.env.get("APP_ALLOWED_ORIGINS")),
  ]
    .filter(Boolean)
    .map((origin) => normalizeOrigin(origin as string));
}

function isLocalDevOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isAllowedOrigin(origin: string | null) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!IS_PROD && isLocalDevOrigin(normalized)) return true;
  return configuredOrigins().includes(normalized);
}

export function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin");
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-notify-secret",
  };
  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = normalizeOrigin(origin);
  }
  return headers;
}

export function handleCors(req: Request, methods = "POST, OPTIONS") {
  if (req.method !== "OPTIONS") return null;
  const headers = corsHeaders(req);
  headers["Access-Control-Allow-Methods"] = methods;
  if (!isAllowedOrigin(req.headers.get("Origin"))) {
    return new Response(null, { status: 403, headers });
  }
  return new Response(null, { status: 204, headers });
}

export function rejectDisallowedOrigin(req: Request) {
  if (isAllowedOrigin(req.headers.get("Origin"))) return null;
  return Response.json({ error: "forbidden" }, { status: 403, headers: corsHeaders(req) });
}
