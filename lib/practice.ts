import { GROUP_RINGS, groupSlots, type GroupBall } from "./group-scoring";

export type PracticePlayer = { id: string; name: string };
export type PracticeGame = { version: 1; id: string; players: PracticePlayer[]; balls: GroupBall[]; startedAt: number; completedAt: number | null };
export type PracticeState = { version: 1; draft: PracticeGame | null; history: PracticeGame[]; names: string[] };
export const emptyPractice = (): PracticeState => ({ version: 1, draft: null, history: [], names: ["You", ""] });
export function validPracticeGame(value: unknown): value is PracticeGame {
  if (!value || typeof value !== "object") return false;
  const game = value as PracticeGame;
  if (game.version !== 1 || typeof game.id !== "string" || !game.id || !Number.isFinite(game.startedAt)
    || !Array.isArray(game.players) || game.players.length < 1 || game.players.length > 3
    || game.players.some(p => !p || typeof p.id !== "string" || !p.id || typeof p.name !== "string" || !p.name.trim() || p.name.length > 40)
    || new Set(game.players.map(p => p.id)).size !== game.players.length
    || !Array.isArray(game.balls) || game.balls.length > 9
    || (game.completedAt !== null && (!Number.isFinite(game.completedAt) || game.completedAt < game.startedAt || game.balls.length !== 9))) return false;
  const slots = groupSlots(game.players.map(p => p.id));
  return game.balls.every((ball, i) => ball && ball.player_user_id === slots[i].player_user_id && ball.ball_number === slots[i].ball_number && GROUP_RINGS.includes(ball.score));
}
export function parsePractice(raw: string | null): PracticeState {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || value.version !== 1) return emptyPractice();
    return { version: 1, draft: validPracticeGame(value.draft) && value.draft.completedAt === null ? value.draft : null,
      history: Array.isArray(value.history) ? value.history.filter((g: unknown) => validPracticeGame(g) && g.completedAt !== null).slice(0, 30) : [],
      names: Array.isArray(value.names) && value.names.length > 0 && value.names.length <= 3 && value.names.every((n: unknown) => typeof n === "string" && n.length <= 40) ? value.names : ["You", ""] };
  } catch { return emptyPractice(); }
}
export function completePractice(state: PracticeState, now: number): PracticeState {
  if (!state.draft || state.draft.balls.length !== 9 || !validPracticeGame(state.draft)) throw new Error("Record all nine balls first.");
  const completed = { ...state.draft, completedAt: Math.max(now, state.draft.startedAt) };
  return { ...state, draft: null, history: [completed, ...state.history.filter(g => g.id !== completed.id)].slice(0, 30) };
}

