import type { VercelRequest, VercelResponse } from "@vercel/node";

const IS_PROD =
  process.env.IS_PRODUCTION === "true" ||
  process.env.NODE_ENV === "production";

const DEFAULT_HEADERS = "Content-Type, Authorization, X-Requested-With";

function splitOrigins(value?: string) {
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
    process.env.EXPO_PUBLIC_SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    ...splitOrigins(process.env.APP_ALLOWED_ORIGINS),
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

export function isOriginAllowed(origin?: string | null) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!IS_PROD && isLocalDevOrigin(normalized)) return true;
  return configuredOrigins().includes(normalized);
}

export function applyCors(
  req: VercelRequest,
  res: VercelResponse,
  methods = "POST, OPTIONS"
) {
  const origin = req.headers.origin;
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", DEFAULT_HEADERS);
  if (typeof origin === "string" && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", normalizeOrigin(origin));
  }
}

export function rejectDisallowedOrigin(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin;
  if (typeof origin === "string" && !isOriginAllowed(origin)) {
    res.status(403).json({ error: "forbidden" });
    return true;
  }
  return false;
}

export function handleCorsPreflight(
  req: VercelRequest,
  res: VercelResponse,
  methods = "POST, OPTIONS"
) {
  applyCors(req, res, methods);
  if (req.method !== "OPTIONS") return false;
  if (rejectDisallowedOrigin(req, res)) return true;
  res.status(204).end();
  return true;
}
