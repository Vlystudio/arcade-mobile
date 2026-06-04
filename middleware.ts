import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const AUTH_PATHS = /^\/(login|signup|reset-password|mfa-setup|mfa-verify|auth)/;

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
  if (!limiters) return undefined;

  const { pathname } = new URL(request.url);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "127.0.0.1";

  const limiter = AUTH_PATHS.test(pathname) ? limiters.auth : limiters.global;
  const { success, limit, remaining, reset } = await limiter.limit(ip);

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

export const config = {
  matcher: ["/((?!_expo/static|assets/|favicon\\.ico|\\.well-known).*)"],
};
