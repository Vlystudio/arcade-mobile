import type { VercelRequest, VercelResponse } from "@vercel/node";
import imageHandler from "./_image";
import textHandler from "./_text";

// Image + text moderation are served by a single Vercel function (Hobby's
// 12-Serverless-Function cap). The dynamic [kind] segment keeps the original
// /api/moderation/image and /api/moderation/text URLs working unchanged — the
// inner handlers do their own CORS / rate-limit / method checks.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const kind = Array.isArray(req.query.kind) ? req.query.kind[0] : req.query.kind;
  if (kind === "image") return imageHandler(req, res);
  if (kind === "text") return textHandler(req, res);
  return res.status(404).json({ error: "not_found" });
}
