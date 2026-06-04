import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let limiter: Ratelimit | null = null;

function getLimiter(): Ratelimit | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  if (!limiter) {
    limiter = new Ratelimit({
      redis: new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      }),
      limiter: Ratelimit.slidingWindow(30, "60 s"),
      prefix: "rl:api",
    });
  }
  return limiter;
}

export function getClientIp(req: any): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  const raw = typeof forwarded === "string" ? forwarded : Array.isArray(forwarded) ? forwarded[0] : null;
  return raw?.split(",")[0].trim() ?? req.socket?.remoteAddress ?? "unknown";
}

export async function checkRateLimit(req: any, res: any): Promise<boolean> {
  const rl = getLimiter();
  if (!rl) return true;

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
}
