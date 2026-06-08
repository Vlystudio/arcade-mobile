// Security: admin check is UX-only. All mutations use SECURITY DEFINER RPCs that enforce MFA + is_admin() server-side.

export type TournamentRequest = {
  id: string;
  user_id: string;
  username: string;
  title: string;
  description: string | null;
  game_type: string | null;
  proposed_date: string | null;
  max_teams: number;
  status: "pending" | "approved" | "denied";
  created_at: string;
};

export type ManageTournament = {
  id: string;
  title: string;
  game_type: string | null;
  status: string;
  proposed_date: string | null;
  is_official: boolean;
  is_individual: boolean;
  signup_qr_token: string | null;
  signup_qr_active: boolean;
  signup_qr_issued_at: string | null;
  max_players: number;
  registered_count: number;
  ff_signup_time: string | null;
  ff_start_time: string | null;
  has_bracket: boolean;
  created_at: string;
};

export type BracketSlot  = { user_id: string; username: string; seed: number; status: string; eliminated_game: number | null; final_rank: number | null };
export type BracketScore = { user_id: string; username: string; score: number; rank_in_game: number; rank_points: number | null; is_eliminated: boolean; player_seed: number | null };
export type BracketGame  = { id: string; game_number: number; status: string; scores: BracketScore[] | null };
export type BracketGroup = { id: string; group_number: number; status: string; slots: BracketSlot[] | null; games: BracketGame[] | null };
export type BracketRound = { id: string; round_number: number; round_name: string; status: string; groups: BracketGroup[] | null };
