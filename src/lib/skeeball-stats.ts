import { supabase } from "../../lib/supabase";

export const RING_VALUES = [10, 20, 30, 40, 50, 100] as const;

export type RingCounts = Partial<Record<string, number>>;

export type PlayerWeek = {
  week_of: string;
  games: number;
  avg: number;
  best: number;
  worst: number;
  balls: number;
  rings: RingCounts;
};

export type PlayerTotals = {
  games: number;
  avg: number | null;
  best: number | null;
  worst: number | null;
  balls: number;
  rings: RingCounts;
};

export type PlayerStats = {
  weeks: PlayerWeek[];
  totals: PlayerTotals;
};

export type TeamWeek = {
  week_of: string;
  games: number;
  avg: number;
  best: number;
  points: number;
  best_placement: number | null;
};

export type TeamMemberStats = {
  user_id: string;
  username: string;
  avatar_url: string | null;
  games: number;
  avg: number;
  best: number;
  balls: number;
  best_week: string | null;
  worst_week: string | null;
  weeks: { week_of: string; avg: number; games: number; best: number }[];
};

export type TeamStats = {
  weeks: TeamWeek[];
  members: TeamMemberStats[];
  season_points: number;
};

export type SkeeSeason = {
  id: string;
  name: string;
  start_week: string;
  end_week: string;
  status: "active" | "completed";
};

export type StandingRow = {
  team_id: string;
  team_name: string;
  matches_played: number;
  gold: number;
  silver: number;
  bronze: number;
  total_points: number;
  avg_score: number | null;
  best_score: number | null;
};

/** All skee-ball seasons, newest first. */
export async function fetchSkeeSeasons(): Promise<SkeeSeason[]> {
  const { data } = await supabase
    .from("skeeball_seasons")
    .select("id, name, start_week, end_week, status")
    .order("start_week", { ascending: false });
  return (data ?? []) as SkeeSeason[];
}

export async function fetchPlayerStats(
  userId: string,
  season?: SkeeSeason | null,
): Promise<PlayerStats | null> {
  const { data, error } = await supabase.rpc("rpc_skeeball_player_stats", {
    p_user_id: userId,
    p_start: season?.start_week ?? null,
    p_end: season?.end_week ?? null,
  });
  if (error || !data || (data as any).error) return null;
  return { weeks: (data as any).weeks ?? [], totals: (data as any).totals ?? emptyTotals() };
}

export async function fetchTeamStats(
  teamId: string,
  season?: SkeeSeason | null,
): Promise<TeamStats | null> {
  const { data, error } = await supabase.rpc("rpc_skeeball_team_stats", {
    p_team_id: teamId,
    p_start: season?.start_week ?? null,
    p_end: season?.end_week ?? null,
  });
  if (error || !data || (data as any).error) return null;
  return {
    weeks: (data as any).weeks ?? [],
    members: (data as any).members ?? [],
    season_points: (data as any).season_points ?? 0,
  };
}

export async function fetchStandings(season?: SkeeSeason | null): Promise<StandingRow[]> {
  const { data, error } = await supabase.rpc("rpc_skeeball_standings", {
    p_start: season?.start_week ?? null,
    p_end: season?.end_week ?? null,
  });
  if (error || !data || (data as any).error) return [];
  return ((data as any).standings ?? []) as StandingRow[];
}

function emptyTotals(): PlayerTotals {
  return { games: 0, avg: null, best: null, worst: null, balls: 0, rings: {} };
}

/** Ring percentages for the 10/20/30/40/50/100 breakdown. */
export function ringPercents(rings: RingCounts): { ring: number; count: number; pct: number }[] {
  const total = RING_VALUES.reduce((a, r) => a + (rings[String(r)] ?? 0), 0);
  return RING_VALUES.map((ring) => {
    const count = rings[String(ring)] ?? 0;
    return { ring, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 };
  });
}

/** "Wk 3" if the week falls inside a season, otherwise a short date. */
export function weekLabel(weekOf: string, season?: SkeeSeason | null): string {
  if (season) {
    const diff = Math.round(
      (new Date(weekOf).getTime() - new Date(season.start_week).getTime()) / (7 * 86400000),
    );
    if (diff >= 0 && diff < 8) return `Wk ${diff + 1}`;
  }
  return new Date(weekOf).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Current season week number (1-8) or null if outside the window. */
export function seasonWeekNumber(season: SkeeSeason): number | null {
  const now = new Date();
  now.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // this week's Monday
  const diff = Math.round(
    (now.getTime() - new Date(season.start_week).getTime()) / (7 * 86400000),
  );
  return diff >= 0 && diff < 8 ? diff + 1 : null;
}

// ── Shooting position stats & lineup optimizer ──────────────────────────────

export type PositionStat = { games: number; avg: number; best: number };

export type PlayerPositionStats = {
  user_id: string;
  username: string;
  games: number;
  overall_avg: number;
  positions: Partial<Record<"1" | "2" | "3", PositionStat>>;
};

export async function fetchPositionStats(
  teamId: string,
  season?: SkeeSeason | null,
): Promise<PlayerPositionStats[]> {
  const { data, error } = await supabase.rpc("rpc_skeeball_position_stats", {
    p_team_id: teamId,
    p_start: season?.start_week ?? null,
    p_end: season?.end_week ?? null,
  });
  if (error || !data || (data as any).error) return [];
  return ((data as any).players ?? []) as PlayerPositionStats[];
}

export type OrderSuggestion = {
  order: { user_id: string; username: string; position: number; avg: number | null }[];
  tips: string[];
};

/**
 * Statistical lineup recommendation: tries every assignment of the top
 * players to positions 1-3 and keeps the one with the highest expected
 * total (position avg when known, overall avg otherwise).
 */
export function suggestOrder(players: PlayerPositionStats[]): OrderSuggestion | null {
  const pool = players.filter((p) => p.games > 0).slice(0, 3);
  if (pool.length < 2) return null;

  const score = (p: PlayerPositionStats, pos: number) =>
    p.positions[String(pos) as "1" | "2" | "3"]?.avg ?? p.overall_avg;

  // All permutations of the pool across positions 1..pool.length
  const perms: PlayerPositionStats[][] = [];
  const permute = (rest: PlayerPositionStats[], acc: PlayerPositionStats[]) => {
    if (rest.length === 0) { perms.push(acc); return; }
    rest.forEach((p, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, p]));
  };
  permute(pool, []);

  let best: PlayerPositionStats[] = perms[0];
  let bestTotal = -1;
  for (const perm of perms) {
    const total = perm.reduce((sum, p, i) => sum + score(p, i + 1), 0);
    if (total > bestTotal) { bestTotal = total; best = perm; }
  }

  const order = best.map((p, i) => ({
    user_id: p.user_id,
    username: p.username,
    position: i + 1,
    avg: p.positions[String(i + 1) as "1" | "2" | "3"]?.avg ?? null,
  }));

  // Quick tips: positions where a player meaningfully out-performs their
  // overall avg (>=5% lift across 2+ games). When multiple players favor
  // the same position, explain how the conflict was resolved.
  const POS_LABEL = ["first", "second", "third"];
  const tips: string[] = [];

  type Pref = { player: PlayerPositionStats; pos: number; pct: number; avg: number };
  const prefs: Pref[] = [];
  for (const p of pool) {
    let bestPos: number | null = null;
    let bestPct = 0;
    for (const pos of [1, 2, 3]) {
      const st = p.positions[String(pos) as "1" | "2" | "3"];
      if (!st || st.games < 2 || p.overall_avg <= 0) continue;
      const pct = Math.round(((st.avg - p.overall_avg) / p.overall_avg) * 100);
      if (pct >= 5 && pct > bestPct) { bestPct = pct; bestPos = pos; }
    }
    if (bestPos != null) {
      prefs.push({ player: p, pos: bestPos, pct: bestPct, avg: score(p, bestPos) });
    }
  }

  const assignedPos = (userId: string) => order.find((o) => o.user_id === userId)?.position ?? null;

  // Group preferences by position to detect conflicts
  const byPos = new Map<number, Pref[]>();
  for (const pr of prefs) {
    byPos.set(pr.pos, [...(byPos.get(pr.pos) ?? []), pr]);
  }

  for (const [pos, group] of byPos) {
    if (group.length === 1) {
      const pr = group[0];
      const got = assignedPos(pr.player.user_id);
      tips.push(
        got === pos
          ? `${pr.player.username} averages ${pr.pct}% higher when shooting ${POS_LABEL[pos - 1]}.`
          : `${pr.player.username} shoots best ${POS_LABEL[pos - 1]} (+${pr.pct}%), but the lineup scores higher overall with them ${got ? POS_LABEL[got - 1] : "elsewhere"}.`,
      );
    } else {
      // Conflict: multiple players favor the same position — the optimizer
      // already resolved it for max total; explain who got it and why.
      const sorted = [...group].sort((a, b) => b.avg - a.avg);
      const winner = sorted.find((pr) => assignedPos(pr.player.user_id) === pos) ?? sorted[0];
      const others = sorted.filter((pr) => pr.player.user_id !== winner.player.user_id);
      const names = group.map((pr) => pr.player.username).join(" and ");
      const otherNotes = others
        .map((pr) => {
          const got = assignedPos(pr.player.user_id);
          return got ? `${pr.player.username} slots ${POS_LABEL[got - 1]} (still strong there)` : pr.player.username;
        })
        .join("; ");
      tips.push(
        `${names} both shoot best ${POS_LABEL[pos - 1]} — ${winner.player.username} takes it with the higher average there (${winner.avg}), and ${otherNotes}.`,
      );
    }
  }

  if (tips.length === 0 && pool.length >= 2) {
    tips.push("Not enough per-position data for strong patterns yet — keep recording your shooting order each week.");
  }

  return { order, tips };
}

// ── Weekly schedule & match history ──────────────────────────────────────────

export type WeekHistoryOpponent = {
  team_id: string;
  team_name: string;
  placement: number | null;
  game_score: number;
};

export type WeekHistoryEntry = {
  week_of: string;
  placement: number | null;
  points: number;
  game_score: number;
  slot_time: string | null;
  opponents: WeekHistoryOpponent[];
};

export type TeamWeekHistory = {
  weeks: WeekHistoryEntry[];
  upcoming: { week_of: string; slot_time: string; week_label: string | null } | null;
};

export async function fetchTeamWeekHistory(
  teamId: string,
  season?: SkeeSeason | null,
): Promise<TeamWeekHistory | null> {
  const { data, error } = await supabase.rpc("rpc_skeeball_team_week_history", {
    p_team_id: teamId,
    p_start: season?.start_week ?? null,
    p_end: season?.end_week ?? null,
  });
  if (error || !data || (data as any).error) return null;
  return {
    weeks: (data as any).weeks ?? [],
    upcoming: (data as any).upcoming ?? null,
  };
}

/** Up/down trend between the last two weeks with data. Null if fewer than 2. */
export function weeklyTrend(
  weeks: { avg: number }[],
): { direction: "up" | "down" | "flat"; pct: number } | null {
  if (weeks.length < 2) return null;
  const prev = weeks[weeks.length - 2].avg;
  const last = weeks[weeks.length - 1].avg;
  if (prev <= 0) return null;
  const pct = Math.round(((last - prev) / prev) * 100);
  return { direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat", pct: Math.abs(pct) };
}
