import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Durable quotas also apply when requests hit different server instances. */
export async function checkServiceQuota(client: SupabaseClient, res: any, scope: string, limit: number, seconds: number) {
  const { data, error } = await client.rpc("consume_service_quota", { p_scope: scope, p_limit: limit, p_seconds: seconds });
  if (!error && data === true) return true;
  res.statusCode = error ? 503 : 429;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Retry-After", String(seconds));
  res.end(JSON.stringify({ error: error ? "Service temporarily unavailable." : "Please wait before trying again." }));
  return false;
}
const cache = new Map<string, { expires: number; work: Promise<unknown> }>();
/** Stats in the prompt are the data version; identical work shares an in-flight result. */
export function cachedServiceWork<T>(scope: string, prompt: string, work: () => Promise<T>): Promise<T> {
  const key = crypto.createHash("sha256").update(scope + "\n" + prompt).digest("hex");
  const found = cache.get(key);
  if (found && found.expires > Date.now()) return found.work as Promise<T>;
  const pending = work().then((value) => {
    if (value == null) cache.delete(key);
    return value;
  }).catch((error) => { cache.delete(key); throw error; });
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 15 * 60_000, work: pending });
  return pending;
}
