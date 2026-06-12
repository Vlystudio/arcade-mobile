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
 * AI lineup coach. Gathers season position stats for the requesting team
 * (and optionally an opponent), then asks an LLM for a recommended
 * shooting order and short coaching tips. Server-side only — the prompt
 * is built from aggregate stats, never from client-supplied text.
 */
export default async function handler(req: any, res: any) {
  if (handleCorsPreflight(req, res, "POST, OPTIONS")) return;
  applyCors(req, res, "POST, OPTIONS");
  if (rejectDisallowedOrigin(req, res)) return;

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }
  if (!(await checkRateLimit(req, res))) return;

  const body = parseBody(req.body);
  const teamId = typeof body?.teamId === "string" ? body.teamId.trim() : "";
  const opponentTeamId = typeof body?.opponentTeamId === "string" ? body.opponentTeamId.trim() : "";
  const seasonStart = typeof body?.seasonStart === "string" ? body.seasonStart : null;
  const seasonEnd = typeof body?.seasonEnd === "string" ? body.seasonEnd : null;

  if (!UUID_RE.test(teamId)) {
    return sendJson(res, 400, { error: "Invalid team ID." });
  }
  if (opponentTeamId && !UUID_RE.test(opponentTeamId)) {
    return sendJson(res, 400, { error: "Invalid opponent team ID." });
  }

  // Gather aggregate stats via the position-stats RPC (service role allowed)
  const [teamRes, teamStatsRes, oppRes] = await Promise.all([
    supabase.from("teams").select("name").eq("id", teamId).maybeSingle(),
    supabase.rpc("rpc_skeeball_position_stats", {
      p_team_id: teamId, p_start: seasonStart, p_end: seasonEnd,
    }),
    opponentTeamId
      ? Promise.all([
          supabase.from("teams").select("name").eq("id", opponentTeamId).maybeSingle(),
          supabase.rpc("rpc_skeeball_position_stats", {
            p_team_id: opponentTeamId, p_start: seasonStart, p_end: seasonEnd,
          }),
        ])
      : Promise.resolve(null),
  ]);

  const teamName = teamRes.data?.name ?? "Your team";
  const players = (teamStatsRes.data as any)?.players ?? [];
  if (!players.length) {
    return sendJson(res, 200, {
      ok: false,
      message: "Not enough league data yet. Play more league games this season to unlock coaching.",
    });
  }

  const opponentName = oppRes?.[0]?.data?.name ?? null;
  const opponentPlayers = oppRes ? ((oppRes[1].data as any)?.players ?? []) : [];

  const prompt = buildPrompt(teamName, players, opponentName, opponentPlayers);

  try {
    const result = await callLLM(prompt);
    if (!result) {
      return sendJson(res, 503, { error: "AI coach is not configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY." });
    }
    return sendJson(res, 200, { ok: true, ...result });
  } catch (err: any) {
    console.error("[skeeball-coach] LLM call failed", err?.message ?? err);
    return sendJson(res, 502, { error: "Coach analysis failed. Please try again." });
  }
}

function describePlayers(players: any[]): string {
  return players.map((p: any) => {
    const positions = [1, 2, 3].map((pos) => {
      const st = p.positions?.[String(pos)];
      return st ? `P${pos}: avg ${st.avg} over ${st.games} games (best ${st.best})` : `P${pos}: no data`;
    }).join("; ");
    return `- ${p.username}: overall avg ${p.overall_avg} across ${p.games} games. By shooting position → ${positions}`;
  }).join("\n");
}

function buildPrompt(
  teamName: string,
  players: any[],
  opponentName: string | null,
  opponentPlayers: any[],
): string {
  let prompt = `You are a skee-ball league coach. In this league, 3 players per team each shoot 3 balls per game (9 total). Shooting position P1 goes first, P2 second, P3 last. Higher scores are better (rings: 10-100 per ball, max 300/game per player... realistically 30-150).

TEAM "${teamName}" season stats by shooting position:
${describePlayers(players)}
`;

  if (opponentName && opponentPlayers.length) {
    prompt += `
UPCOMING OPPONENT "${opponentName}" season stats:
${describePlayers(opponentPlayers)}
`;
  }

  prompt += `
Recommend the optimal shooting order for "${teamName}". Rules:
- Base recommendations strictly on the data above (position averages, sample sizes).
- Mention when sample sizes are too small to be confident.
- If opponent data is provided, factor in matchups (e.g., counter a strong opener).
- Keep each tip to one short sentence, written to the team, plain language.

Respond with ONLY valid JSON in exactly this shape:
{
  "order": [{"username": "...", "position": 1, "reason": "one short sentence"}],
  "tips": ["short tip", "short tip"],
  "confidence": "high" | "medium" | "low"
}`;

  return prompt;
}

async function callLLM(prompt: string): Promise<{ order: any[]; tips: string[]; confidence: string } | null> {
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
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) throw new Error(`anthropic_${r.status}`);
    const data = await r.json();
    text = data?.content?.[0]?.text ?? null;
  } else if (openaiKey) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 800,
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

  // Extract the JSON object (Claude may wrap it in prose/code fences)
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no_json_in_response");
  const parsed = JSON.parse(match[0]);

  return {
    order: Array.isArray(parsed.order) ? parsed.order.slice(0, 4) : [],
    tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 6).map(String) : [],
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
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
