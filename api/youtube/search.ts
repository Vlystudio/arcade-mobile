import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "../_ratelimit";
import { applyCors, handleCorsPreflight, rejectDisallowedOrigin } from "../_cors";

function sendJson(res: any, status: number, body: any) {
  res.status(status).json(body);
}

// Karaoke queries repeat heavily across patrons, while YouTube search costs
// ~101 quota units against a 10,000/day default (~99 searches/day total).
// Serving repeats from karaoke_search_cache stretches that to several
// hundred user-facing searches per day.
const CACHE_TTL_DAYS = 7;

const supabase =
  process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL)!,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } }
      )
    : null;

function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
}

export default async function handler(req: any, res: any) {
  if (handleCorsPreflight(req, res, "GET, OPTIONS")) return;
  applyCors(req, res, "GET, OPTIONS");
  if (rejectDisallowedOrigin(req, res)) return;

  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (!(await checkRateLimit(req, res))) return;

  const q = String(req.query?.q ?? "").trim();
  if (!q) return sendJson(res, 400, { error: "Missing query" });

  // ── Cache first: identical queries within the TTL cost zero quota ──
  const queryNorm = normalizeQuery(q);
  if (supabase) {
    try {
      const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 86400000).toISOString();
      const { data: hit } = await supabase
        .from("karaoke_search_cache")
        .select("results, hits")
        .eq("query_norm", queryNorm)
        .gte("created_at", cutoff)
        .maybeSingle();
      if (hit?.results) {
        void supabase
          .from("karaoke_search_cache")
          .update({ hits: (hit.hits ?? 0) + 1 })
          .eq("query_norm", queryNorm)
          .then(() => {});
        return sendJson(res, 200, { items: hit.results, cached: true });
      }
    } catch {
      // cache unavailable — fall through to live search
    }
  }

  const apiKey = process.env.YOUTUBE_DATA_API_KEY;
  if (!apiKey) {
    return sendJson(res, 503, { error: "YouTube search not configured" });
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("q", q + " karaoke");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "12");
  url.searchParams.set("key", apiKey);

  let data: any;
  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) {
      console.error("[youtube-search] upstream error", resp.status);
      return sendJson(res, 502, { error: "YouTube search failed" });
    }
    data = await resp.json();
  } catch (e: any) {
    console.error("[youtube-search] fetch failed", e?.message ?? e);
    return sendJson(res, 502, { error: "YouTube search failed" });
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

  // Filter out videos that block embedding (saves wasted queue slots)
  let embeddableIds = new Set<string>(items.map((i: any) => i.videoId));
  if (items.length > 0) {
    try {
      const ids = items.map((i: any) => i.videoId).join(",");
      const statusUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
      statusUrl.searchParams.set("part", "status");
      statusUrl.searchParams.set("id", ids);
      statusUrl.searchParams.set("key", apiKey);
      const statusResp = await fetch(statusUrl.toString());
      if (statusResp.ok) {
        const statusData = await statusResp.json();
        embeddableIds = new Set(
          (statusData.items ?? [])
            .filter((v: any) => v.status?.embeddable !== false)
            .map((v: any) => v.id as string)
        );
      }
    } catch (_) {
      // On failure keep all results rather than showing empty list
    }
  }

  const finalItems = items.filter((i: any) => embeddableIds.has(i.videoId));

  // Store for the next patron searching the same song (only useful results;
  // upsert refreshes created_at so popular queries stay warm)
  if (supabase && finalItems.length > 0) {
    try {
      await supabase.from("karaoke_search_cache").upsert({
        query_norm: queryNorm,
        results: finalItems,
        created_at: new Date().toISOString(),
      });
    } catch {
      // caching is best-effort — never fail the search over it
    }
  }

  return sendJson(res, 200, { items: finalItems });
}
