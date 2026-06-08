// Security: admin check is UX-only. All mutations use SECURITY DEFINER RPCs that enforce MFA + is_admin() server-side.

export type AdminTeam = {
  id: string;
  name: string;
  captain_username: string;
  member_count: number;
  created_at: string;
};

export type SupportTicket = {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  username: string;
  avatar_url: string | null;
};

export type SupportMsg = {
  id: string;
  sender_id: string;
  content: string;
  is_admin_msg: boolean;
  created_at: string;
};

export type MainTab =
  | "reviews"
  | "stats"
  | "health"
  | "teams"
  | "tournaments"
  | "users"
  | "forums"
  | "scheduler"
  | "support"
  | "karaoke"
  | "trivia";
