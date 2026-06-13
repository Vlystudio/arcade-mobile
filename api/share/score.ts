import { createClient } from "@supabase/supabase-js";

// Link-preview endpoint for shared scores (/s/<id> rewrites here).
// Crawlers (Discord/iMessage/Slack) don't run JS, so the SPA can't give
// them per-score Open Graph tags — this function returns a tiny HTML page
// with the real title/description, then forwards humans to the app's
// /score-share page.
const supabase = createClient(
  (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default async function handler(req: any, res: any) {
  const id = String(req.query?.id ?? "");
  const base = process.env.EXPO_PUBLIC_SITE_URL ?? "https://www.vlystudios.com";
  const appUrl = `${base}/score-share?id=${encodeURIComponent(id)}`;

  let title = "Arcade High Score";
  let desc = "See the leaderboard on ArcadeTracker.";
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    try {
      const { data } = await supabase.rpc("rpc_public_score_card", { p_score_id: id });
      if (data && !data.error) {
        title = `${data.username} — #${data.rank} on ${data.game_name} 🏆`;
        desc = `${Number(data.score).toLocaleString()} points. Think you can beat it?`;
      }
    } catch { /* generic preview */ }
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
  res.status(200).send(`<!doctype html><html><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:image" content="${base}/icon.png">
<meta name="twitter:card" content="summary">
<meta http-equiv="refresh" content="0;url=${esc(appUrl)}">
</head><body style="background:#000;color:#fff;font-family:sans-serif;text-align:center;padding-top:80px">
<p>${esc(title)}</p><p><a style="color:#06b6d4" href="${esc(appUrl)}">View the score</a></p>
</body></html>`);
}
