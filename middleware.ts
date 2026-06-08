import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const AUTH_PATHS = /^\/(login|signup|reset-password|mfa-setup|mfa-verify|auth)/;
const API_PATHS = /^\/api\//;
const SENSITIVE_PATHS = /^\/(admin|architect|delete-account|profile|support-chat)/;
const IS_PROD =
  process.env.IS_PRODUCTION === "true" ||
  process.env.NODE_ENV === "production";

function buildLimiters() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return {
    global: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(300, "60 s"),
      prefix: "rl:global",
    }),
    auth: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "60 s"),
      prefix: "rl:auth",
    }),
  };
}

let limiters: ReturnType<typeof buildLimiters> | undefined;

export default async function middleware(request: Request): Promise<Response | undefined> {
  if (!limiters) limiters = buildLimiters();
  const { pathname } = new URL(request.url);
  const sensitive = API_PATHS.test(pathname) || AUTH_PATHS.test(pathname) || SENSITIVE_PATHS.test(pathname);

  if (!limiters) {
    if (IS_PROD && sensitive) {
      return serviceUnavailable();
    }
    if (!IS_PROD) {
      console.warn("[middleware] Upstash env vars missing; rate limiting disabled in development.");
    }
    return undefined;
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "127.0.0.1";

  const limiter = AUTH_PATHS.test(pathname) ? limiters.auth : limiters.global;
  let result: Awaited<ReturnType<typeof limiter.limit>>;
  try {
    result = await limiter.limit(ip);
  } catch (error) {
    console.error("[middleware] rate limit error", error instanceof Error ? error.message : error);
    return IS_PROD && sensitive ? serviceUnavailable() : undefined;
  }

  const { success, limit, reset } = result;

  if (!success) {
    return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(reset),
      },
    });
  }

  return undefined;
}

function serviceUnavailable() {
  return new Response(JSON.stringify({ error: "Service temporarily unavailable. Please try again later." }), {
    status: 503,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": "60",
    },
  });
}

export const config = {
  matcher: ["/((?!_expo/static|assets/|favicon\\.ico|\\.well-known).*)"],
};
