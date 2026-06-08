// Security: admin check is UX-only. All mutations use SECURITY DEFINER RPCs that enforce MFA + is_admin() server-side.

export type ReviewTab = "pending" | "approved" | "denied";

export type ReviewScore = {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  game_name: string;
  score: number;
  photo_url: string | null;
  proof_storage_path: string | null;
  created_at: string;
};

export type ConfirmAction = {
  score: ReviewScore;
  toStatus: "approved" | "denied";
  title: string;
  body: string;
  btnLabel: string;
  btnColor: string;
  btnTextColor: string;
};

export type StatsData = {
  pending: number;
  approved: number;
  denied: number;
  today: number;
  gameBreakdown: Array<{ type: string; label: string; count: number }>;
  topPlayers: Array<{ username: string; avatar_url: string | null; game_count: number; best_score: number }>;
};

export type HealthData = {
  totalUsers: number;
  newUsersWeek: number;
  activePlayersWeek: number;
  scoresToday: number;
  pendingQueue: number;
  approvalRate: number;
};
