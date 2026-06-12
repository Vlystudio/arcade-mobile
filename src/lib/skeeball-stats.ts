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
