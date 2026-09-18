export type GroupBall = { player_user_id: string; ball_number: number; score: number };
export const GROUP_RINGS = [10, 20, 30, 40, 50, 100];

/** Three rounds, three balls per round; two players rotate A → B → A. */
export function groupSlots(lineup: string[]) {
  if (!lineup.length || lineup.length > 3 || new Set(lineup).size !== lineup.length) return [];
  const counts: Record<string, number> = {};
  return Array.from({ length: 9 }, (_, index) => {
    const playerId = lineup[Math.floor(index / 3) % lineup.length];
    counts[playerId] = (counts[playerId] ?? 0) + 1;
    return { player_user_id: playerId, ball_number: counts[playerId] };
  });
}

export function orderedGroupBalls(lineup: string[], balls: Record<string, number[]>): GroupBall[] {
  const result: GroupBall[] = [];
  for (const slot of groupSlots(lineup)) {
    const score = balls[slot.player_user_id]?.[slot.ball_number - 1];
    if (!GROUP_RINGS.includes(score)) break;
    result.push({ ...slot, score });
  }
  return result;
}

export function groupBallMap(lineup: string[], balls: GroupBall[]) {
  const result: Record<string, number[]> = Object.fromEntries(lineup.map(id => [id, []]));
  const slots = groupSlots(lineup);
  for (let i = 0; i < Math.min(balls.length, slots.length); i++) {
    const ball = balls[i], slot = slots[i];
    if (ball.player_user_id !== slot.player_user_id || ball.ball_number !== slot.ball_number || !GROUP_RINGS.includes(ball.score)) break;
    result[ball.player_user_id].push(ball.score);
  }
  return result;
}

export function groupTurn(lineup: string[], count: number) {
  if (!lineup.length || count < 0 || count >= 9) return null;
  const round = Math.floor(count / 3);
  return { round, ball: count % 3 + 1, playerId: lineup[round % lineup.length], nextPlayerId: round < 2 ? lineup[(round + 1) % lineup.length] : null };
}
