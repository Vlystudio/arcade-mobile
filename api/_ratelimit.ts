import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// In production (IS_PRODUCTION=true or NODE_ENV=production), missing Upstash
// credentials cause all rate-limited endpoints to return 503 rather than
// silently allowing unlimited traffic. In development they warn and allow through.
const IS_PROD =
  process.env.IS_PRODUCTION === "true" ||
  process.env.NODE_ENV === "production";

let limiter: Ratelimit | null = null;
let credentialsMissing = false;

function getLimiter(): Ratelimit | null {
  if (credentialsMissing) return null;

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    credentialsMissing = true;
    if (IS_PROD) {
      console.error("[ratelimit] PRODUCTION: Upstash env vars not configured — will block all requests");
    } else {
      console.warn("[ratelimit] DEV: Upstash env vars not configured — rate limiting disabled");
    }
    return null;
  }

  if (!limiter) {
    limiter = new Ratelimit({
      redis: new Redis({
        url:   process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      }),
      limiter: Ratelimit.slidingWindow(30, "60 s"),
      prefix: "rl:api",
    });
  }
  return limiter;
}

// Trusted proxy header validation.
// Only trust X-Forwarded-For when request comes through Vercel's edge network.
// Vercel injects x-vercel-forwarded-for which is sanitized.
export function getClientIp(req: any): string {
  // Vercel provides a sanitized header
  const vercelIp = req.headers?.["x-vercel-forwarded-for"];
  if (typeof vercelIp === "string" && vercelIp) {
    return vercelIp.split(",")[0].trim();
  }

  // Fall back to x-forwarded-for (may be spoofable without proxy verification)
  const forwarded = req.headers?.["x-forwarded-for"];
  const raw = typeof forwarded === "string"
    ? forwarded
    : Array.isArray(forwarded) ? forwarded[0] : null;
  if (raw) return raw.split(",")[0].trim();

  return req.socket?.remoteAddress ?? "unknown";
}

export async function checkRateLimit(req: any, res: any): Promise<boolean> {
  const rl = getLimiter();

  // Production without limiter → block all (fail closed)
  if (!rl) {
    if (IS_PROD) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Retry-After", "60");
      res.end(JSON.stringify({
        error: "Service temporarily unavailable. Please try again later.",
      }));
      return false;
    }
    // Dev without limiter → allow
    return true;
  }

  try {
    const { success, limit, remaining, reset } = await rl.limit(getClientIp(req));

    if (!success) {
      res.statusCode = 429;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Retry-After", String(Math.ceil((reset - Date.now()) / 1000)));
      res.setHeader("X-RateLimit-Limit", String(limit));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("X-RateLimit-Reset", String(reset));
      res.end(JSON.stringify({ error: "Too many requests. Please try again later." }));
      return false;
    }

    return true;
  } catch (err) {
    // Redis error
    console.error("[ratelimit] Redis error:", err instanceof Error ? err.message : err);
    if (IS_PROD) {
      // Prod: fail closed on Redis error
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Service temporarily unavailable. Please try again later." }));
      return false;
    }
    // Dev: allow through on Redis error
    return true;
  }
}
