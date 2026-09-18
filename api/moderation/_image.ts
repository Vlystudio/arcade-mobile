import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "../_ratelimit";
import { applyCors, handleCorsPreflight, rejectDisallowedOrigin } from "../_cors";

/** One moderation implementation for every image surface. No caller URLs are fetched. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCorsPreflight(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");
  if (rejectDisallowedOrigin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return res.status(401).json({ error: "unauthorized" });
  if (!(await checkRateLimit(req, res))) return;
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "invalid_json" }); }
  if (typeof body?.path !== "string") return res.status(400).json({ error: "path_required" });
  const client = createClient((process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL)!,
    (process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)!,
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data, error } = await client.functions.invoke("moderate-image", {
    body: { bucket: "message-media", path: body.path, record_type: "message_photo" },
  });
  if (error || !data || (data.ok !== true && !data.flagged)) {
    return res.status(503).json({ ok: false, pending_review: true, error: "moderation_unavailable" });
  }
  return res.status(200).json(data);
}
