import { checkRateLimit } from "../_ratelimit";

function sendJson(res: any, status: number, body: any) {
  res.status(status).json(body);
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (!(await checkRateLimit(req, res))) return;

  const q = String(req.query?.q ?? "").trim();
  if (!q) return sendJson(res, 400, { error: "Missing query" });

  const apiKey = process.env.YOUTUBE_DATA_API_KEY;
  if (!apiKey) {
    return sendJson(res, 503, { error: "YouTube search not configured" });
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", q);
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "12");
  url.searchParams.set("key", apiKey);

  let data: any;
  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) {
      const text = await resp.text();
      return sendJson(res, 502, { error: "YouTube API error", detail: text.slice(0, 200) });
    }
    data = await resp.json();
  } catch (e: any) {
    return sendJson(res, 502, { error: e?.message ?? "YouTube fetch failed" });
  }

  const items = (data.items ?? [])
    .map((item: any) => ({
      videoId: item.id?.videoId ?? "",
      title: item.snippet?.title ?? "Untitled",
      channel: item.snippet?.channelTitle ?? "",
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ??
        item.snippet?.thumbnails?.default?.url ??
        "",
    }))
    .filter((i: any) => i.videoId);

  return sendJson(res, 200, { items });
}
