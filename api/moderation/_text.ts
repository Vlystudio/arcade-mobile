import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit } from "../_ratelimit";
import { applyCors, handleCorsPreflight, rejectDisallowedOrigin } from "../_cors";
import { validateChatMessage } from "../../lib/validation";

const BLOCKLIST = [
  "nigger","nigga","chink","spic","kike","wetback","beaner","gook",
  "jap","cracker","honky","coon","towelhead","sandnigger","raghead",
  "faggot","dyke","tranny","retard","spaz",
  "cunt","whore","slut",
];

function hasBlocklisted(text: string): boolean {
  for (const w of BLOCKLIST) {
    const pat = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pat.test(text)) return true;
  }
  return false;
}

async function openaiModeration(text: string): Promise<boolean> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return false;
  try {
    const r = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "text-moderation-latest", input: text }),
    });
    if (!r.ok) return false;
    const json = await r.json() as any;
    return !!json.results?.[0]?.flagged;
  } catch { return false; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCorsPreflight(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");
  if (rejectDisallowedOrigin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await checkRateLimit(req, res))) return;

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
  const textCheck = validateChatMessage(body?.text);
  if (!textCheck.ok) return res.status(400).json({ error: "invalid_text" });

  if (hasBlocklisted(textCheck.value)) return res.json({ flagged: true, reason: "hate_speech" });

  const flagged = await openaiModeration(textCheck.value);
  return res.json({ flagged, ...(flagged && { reason: "policy_violation" }) });
}

function safeJson(value: string) {
  try { return JSON.parse(value); } catch { return {}; }
}
