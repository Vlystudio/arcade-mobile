export const MENU_CATEGORIES = ["appetizers", "mains", "burgers", "pizza", "drinks", "desserts", "menu"];
const aliases: Record<string, string> = { starters: "appetizers", appetizers: "appetizers", mains: "mains", entrees: "mains", burgers: "burgers", sandwiches: "burgers", pizza: "pizza", flatbreads: "pizza", drinks: "drinks", beverages: "drinks", cocktails: "drinks", beer: "drinks", wine: "drinks", desserts: "desserts" };
export function menuCategory(value?: string | null): string {
  return aliases[(value ?? "").trim().toLowerCase()] ?? "menu";
}
type MenuRow = { id: string; name: string; category: string; photo_url: string | null };
export function prepareMenu<T extends MenuRow>(items: T[], reference: MenuRow[] = []): T[] {
  const nameKey = (s: string) => s.replace(/\s*\([^)]*\)$/, "").trim().toLowerCase();
  const known = new Map(reference.map(item => [nameKey(item.name), item]));
  return items.map(item => {
    const match = known.get(nameKey(item.name));
    const category = menuCategory(item.category);
    return { ...item, category: category === "menu" ? menuCategory(match?.category) : category, photo_url: item.photo_url || match?.photo_url || null };
  }).sort((a, b) => MENU_CATEGORIES.indexOf(a.category) - MENU_CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export type GameDraft = {
  version: 1; userId: string; sessionId: string; teamId: string; teamName: string; lane: number;
  playerBalls: Record<string, number[]>; lineup: string[]; updatedAt: number; previousBest: number | null; scoringGeneration?: number;
};
export function parseGameDraft(raw: string | null, userId: string): GameDraft | null {
  try {
    const d = JSON.parse(raw ?? "null");
    if (!d || d.version !== 1 || d.userId !== userId || typeof d.sessionId !== "string" || typeof d.teamId !== "string" || typeof d.teamName !== "string" || !Number.isInteger(d.lane) || d.lane < 1 || d.lane > 6 || !Number.isFinite(d.updatedAt) || !d.playerBalls || typeof d.playerBalls !== "object" || Array.isArray(d.playerBalls)) return null;
    if (!Array.isArray(d.lineup) || !d.lineup.length || d.lineup.length > 3 || d.lineup.some((id: unknown) => typeof id !== "string") || new Set(d.lineup).size !== d.lineup.length) return null;
    if (d.scoringGeneration !== undefined && (!Number.isInteger(d.scoringGeneration) || d.scoringGeneration < 0)) return null;
    if (Object.keys(d.playerBalls).some(id => !d.lineup.includes(id))) return null;
    const scores = Object.values(d.playerBalls);
    if (scores.some(b => !Array.isArray(b) || b.length > 9 || b.some(n => ![0, 10, 20, 30, 40, 50, 100].includes(n))) || scores.reduce<number>((n, b) => n + (b as number[]).length, 0) > 9) return null;
    if (d.lineup.some((id: string, index: number) => (d.playerBalls[id]?.length ?? 0) > [0, 1, 2].filter(round => round % d.lineup.length === index).length * 3)) return null;
    return { ...d, previousBest: typeof d.previousBest === "number" && d.previousBest >= 0 ? d.previousBest : null };
  } catch { return null; }
}
export function restoreBalls(server: Record<string, number[]>, draft: GameDraft | null, sessionId: string) {
  const sameLineup = draft?.lineup.join(",") === Object.keys(server).join(",");
  return Object.fromEntries(Object.entries(server).map(([id, balls]) => [id,
    balls.length ? balls : sameLineup && draft?.sessionId === sessionId ? draft.playerBalls[id] ?? balls : balls,
  ]));
}
export function nextScoreTarget(best: number, type: string) {
  if (type === "skeeball") return best >= 900 ? null : Math.min(900, (Math.floor(best / 10) + 1) * 10);
  return Math.ceil((best + Math.max(1, best * 0.05)) / (best >= 1000 ? 100 : 1)) * (best >= 1000 ? 100 : 1);
}
export function venueDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function nextLeagueMonday(now = new Date()) {
  const day = new Date(`${venueDate(now)}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + (8 - day.getUTCDay()) % 7);
  return day.toISOString().slice(0, 10);
}
export function scheduleMinutes(slot: string) {
  const match = slot.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return Infinity;
  const hours = Number(match[1]), minutes = Number(match[2]);
  if (minutes > 59 || hours > (match[3] ? 12 : 23)) return Infinity;
  return (match[3] ? hours % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0) : hours) * 60 + minutes;
}
