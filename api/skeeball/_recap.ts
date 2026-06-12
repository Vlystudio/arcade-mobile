import { createClient } from "@supabase/supabase-js";
import { applyCors, handleCorsPreflight, rejectDisallowedOrigin } from "../_cors";
import { checkRateLimit } from "../_ratelimit";

const supabase = createClient(
  (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sendJson(res: any, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * AI recap generator: a short narrative summary of a team's latest league
 * week ("week" mode) or whole season ("season" mode). Built from aggregate
 * data fetched server-side; no client text reaches the prompt.
 */
export default async function handler(req: any, res: any) {
  if (handleCorsPreflight(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");
  if (rejectDisallowedOrigin(req, res)) return;

  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  if (!(await checkRateLimit(req, res))) return;

  const body = parseBody(req.body);
  const teamId = typeof body?.teamId === "string" ? body.teamId.trim() : "";
  const mode = body?.mode === "season" ? "season" : "week";
  const seasonStart = typeof body?.seasonStart === "string" ? body.seasonStart : null;
  const seasonEnd = typeof body?.seasonEnd === "string" ? body.seasonEnd : null;

  if (!UUID_RE.test(teamId)) return sendJson(res, 400, { error: "Invalid team ID." });

  // ── Gather data with the service role ──
  const { data: team } = await supabase.from("teams").select("name").eq("id", teamId).maybeSingle();
  if (!team) return sendJson(res, 404, { error: "Team not found." });

  let sessQuery = supabase
    .from("skeeball_sessions")
    .select("id, week_of, placement, league_points, league_points_adjustment, score_adjustment, league_match_id")
    .eq("team_id", teamId)
    .eq("status", "completed")
    .not("league_match_id", "is", null)
    .order("week_of", { ascending: true });
  if (seasonStart) sessQuery = sessQuery.gte("week_of", seasonStart);
  if (seasonEnd) sessQuery = sessQuery.lte("week_of", seasonEnd);
  const { data: sessions } = await sessQuery;

  if (!sessions?.length) {
    return sendJson(res, 200, { ok: false, message: "No completed league games to recap yet." });
  }

  const scoped = mode === "week"
    ? sessions.filter((s: any) => s.week_of === sessions[sessions.length - 1].week_of)
    : sessions;
  const sessionIds = scoped.map((s: any) => s.id);
  const allIds = sessions.map((s: any) => s.id);

  // Ball scores for player-level numbers (season context even in week mode)
  const { data: balls } = await supabase
    .from("skeeball_ball_scores")
    .select("session_id, player_user_id, score")
    .in("session_id", allIds);

  const playerIds = [...new Set((balls ?? []).map((b: any) => b.player_user_id))];
  const { data: profiles } = playerIds.length
    ? await supabase.from("profiles").select("id, username").in("id", playerIds)
    : { data: [] as any[] };
  const nameOf = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p.username ?? "Unknown"]));

  // Opponents in the scoped matches
  const matchIds = [...new Set(scoped.map((s: any) => s.league_match_id))];
  const { data: oppSessions } = await supabase
    .from("skeeball_sessions")
    .select("id, league_match_id, team_id, placement, score_adjustment, teams(name)")
    .in("league_match_id", matchIds)
    .neq("team_id", teamId)
    .eq("status", "completed");
  const oppIds = (oppSessions ?? []).map((s: any) => s.id);
  const { data: oppBalls } = oppIds.length
    ? await supabase.from("skeeball_ball_scores").select("session_id, score").in("session_id", oppIds)
    : { data: [] as any[] };
  const oppScore = (sid: string) =>
    (oppBalls ?? []).filter((b: any) => b.session_id === sid).reduce((a: number, b: any) => a + b.score, 0);

  // ── Build a compact stats digest ──
  const gameTotal = (sid: string) =>
    (balls ?? []).filter((b: any) => b.session_id === sid).reduce((a: number, b: any) => a + b.score, 0);

  const weekLines = scoped.map((s: any) => {
    const opps = (oppSessions ?? [])
      .filter((o: any) => o.league_match_id === s.league_match_id)
      .map((o: any) => {
        const n = Array.isArray(o.teams) ? o.teams[0]?.name : o.teams?.name;
        return `${n ?? "Unknown"} ${oppScore(o.id) + (o.score_adjustment ?? 0)} pts (placed ${o.placement ?? "?"})`;
      })
      .join(", ");
    return `Week of ${s.week_of}: scored ${gameTotal(s.id) + (s.score_adjustment ?? 0)} pts, placed ${s.placement ?? "?"}, earned ${(s.league_points ?? 0) + (s.league_points_adjustment ?? 0)} league pts. Opponents: ${opps || "n/a"}`;
  }).join("\n");

  // Per-player per-game totals (scoped + season)
  const perPlayer = (ids: string[]) => {
    const byPlayer: Record<string, number[]> = {};
    for (const sid of ids) {
      const totals: Record<string, number> = {};
      for (const b of (balls ?? []).filter((x: any) => x.session_id === sid)) {
        totals[b.player_user_id] = (totals[b.player_user_id] ?? 0) + b.score;
      }
      for (const [uid, t] of Object.entries(totals)) {
        (byPlayer[uid] ??= []).push(t);
      }
    }
    return Object.entries(byPlayer).map(([uid, games]) => ({
      name: nameOf[uid] ?? "Unknown",
      games: games.length,
      avg: Math.round(games.reduce((a, b) => a + b, 0) / games.length),
      best: Math.max(...games),
    }));
  };

  const scopedPlayers = perPlayer(sessionIds);
  const seasonPlayers = perPlayer(allIds);

  const playerLines = scopedPlayers.map((p) => {
    const season = seasonPlayers.find((sp) => sp.name === p.name);
    return `- ${p.name}: ${p.games} games, avg ${p.avg}, best ${p.best}${season && season.games > p.games ? ` (season avg ${season.avg})` : ""}`;
  }).join("\n");

  const prompt = `You are a skee-ball league commentator writing a short, fun, encouraging recap for team "${team.name}". 3 players per team, 9 balls per game, placements earn league points (1st is best).

${mode === "week" ? "THIS WEEK'S RESULTS" : "SEASON RESULTS"}:
${weekLines}

PLAYER PERFORMANCES${mode === "week" ? " (this week, with season context)" : ""}:
${playerLines}

Write the recap. Rules:
- 3 to 5 sentences, energetic but grounded in the numbers above.
- Call out the top performer and anyone who beat their season average.
- Mention the placement result and what it means for league points.
- One concrete, actionable focus for next ${mode === "week" ? "week" : "season"}.

Respond with ONLY valid JSON: {"recap": "...", "highlights": ["short bullet", "short bullet"]}`;

  try {
    const result = await callLLM(prompt);
    if (!result) {
      return sendJson(res, 503, { error: "AI recap is not configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY." });
    }
    return sendJson(res, 200, { ok: true, mode, ...result });
  } catch (err: any) {
    console.error("[skeeball-recap] LLM call failed", err?.message ?? err);
    return sendJson(res, 502, { error: "Recap generation failed. Please try again." });
  }
}

async function callLLM(prompt: string): Promise<{ recap: string; highlights: string[] } | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  let text: string | null = null;

  if (anthropicKey) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) throw new Error(`anthropic_${r.status}`);
    const data = await r.json();
    text = data?.content?.[0]?.text ?? null;
  } else if (openaiKey) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) throw new Error(`openai_${r.status}`);
    const data = await r.json();
    text = data?.choices?.[0]?.message?.content ?? null;
  } else {
    return null;
  }

  if (!text) throw new Error("empty_llm_response");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no_json_in_response");
  const parsed = JSON.parse(match[0]);
  return {
    recap: String(parsed.recap ?? ""),
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 5).map(String) : [],
  };
}

function parseBody(body: unknown): Record<string, any> | null {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch { return null; }
  }
  return typeof body === "object" ? (body as Record<string, any>) : null;
}
