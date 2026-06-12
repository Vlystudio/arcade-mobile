import coachHandler from "./_coach";
import recapHandler from "./_recap";

/**
 * Single AI endpoint dispatching to coach or recap by body.tool.
 * Consolidated because Vercel Hobby caps deployments at 12 functions;
 * underscore-prefixed files are not deployed as routes.
 */
export default async function handler(req: any, res: any) {
  let tool = "coach";
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (body?.tool === "recap") tool = "recap";
  } catch {}
  return tool === "recap" ? recapHandler(req, res) : coachHandler(req, res);
}
