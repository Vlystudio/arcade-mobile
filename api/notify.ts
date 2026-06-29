import type { VercelRequest, VercelResponse } from "@vercel/node";
import securityHandler from "./_security-notify";
import supportHandler from "./_support-notify";

// Security + support notifications share one Vercel function (Hobby's
// 12-Serverless-Function cap). vercel.json rewrites the original
// /api/security-notify and /api/support-notify URLs here with ?kind=, so the
// app needs no change. Inner handlers own their CORS / rate-limit / method checks.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const kind = Array.isArray(req.query.kind) ? req.query.kind[0] : req.query.kind;
  if (kind === "security") return securityHandler(req, res);
  if (kind === "support") return supportHandler(req, res);
  return res.status(404).json({ error: "not_found" });
}
