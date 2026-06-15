// Display catalog for earnable profile titles. Keys must match the server
// (user_earned_title_keys / equipped_title). Earning is enforced in the DB;
// this is purely how each title looks.
export type TitleInfo = { label: string; color: string; icon: string; how: string };

export const TITLES: Record<string, TitleInfo> = {
  beta_founder:        { label: "Founding Member",     color: "#2dd4bf", icon: "rocket",        how: "Joined during the beta, before full launch." },
  centurion:           { label: "The Centurion",       color: "#ef4444", icon: "flame",         how: "The 100 ring is your most-hit shot." },
  monarch_50:          { label: "Monarch of 50's",     color: "#f59e0b", icon: "ribbon",        how: "The 50 ring is your most-hit shot." },
  smooth_roller:       { label: "Smooth Roller",       color: "#a855f7", icon: "disc",          how: "The 40 ring is your most-hit shot." },
  steady_hand:         { label: "Steady Hand",         color: "#22c55e", icon: "hand-left",     how: "The 30 ring is your most-hit shot." },
  on_the_board:        { label: "On the Board",        color: "#06b6d4", icon: "trending-up",   how: "The 20 ring is your most-hit shot." },
  warming_up:          { label: "Warming Up",          color: "#9aa0a6", icon: "thermometer",   how: "The 10 ring is your most-hit shot." },
  tournament_champion: { label: "Tournament Champion", color: "#f59e0b", icon: "trophy",        how: "Won an arcade tournament." },
  season_champion:     { label: "Season Champion",     color: "#fbbf24", icon: "medal",         how: "On the winning team of a league season." },

  // Role flair — granted by your role, not earned through play.
  the_creator:         { label: "The Creator",         color: "#c084fc", icon: "color-wand",    how: "Built ArcadeApp. There's only one." },
  the_house:           { label: "The House",           color: "#fbbf24", icon: "diamond",       how: "Owns the arcade. The house always wins." },
  arcade_warden:       { label: "Arcade Warden",       color: "#8b5cf6", icon: "shield-half",   how: "Keeps order on the floor as an admin." },
  vanguard:            { label: "Vanguard",            color: "#34d399", icon: "flag",          how: "A front-line beta tester." },
};

export function titleInfo(key: string | null | undefined): TitleInfo | null {
  if (!key) return null;
  return TITLES[key] ?? null;
}

export const PRONOUN_PRESETS = ["he/him", "she/her", "they/them", "he/they", "she/they", "any pronouns"];
