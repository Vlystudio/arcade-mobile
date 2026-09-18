export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_deletion_jobs: {
        Row: {
          stage: string
          updated_at: string
          user_id: string
        }
        Insert: {
          stage: string
          updated_at?: string
          user_id: string
        }
        Update: {
          stage?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string | null
          created_at: string | null
          details: Json | null
          id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          admin_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          admin_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      ai_verification_config: {
        Row: {
          id: number
          mode: string
          updated_at: string
        }
        Insert: {
          id?: number
          mode?: string
          updated_at?: string
        }
        Update: {
          id?: number
          mode?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_announcements: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          beta_open: boolean
          id: number
          updated_at: string
        }
        Insert: {
          beta_open?: boolean
          id?: number
          updated_at?: string
        }
        Update: {
          beta_open?: boolean
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      beta_reports: {
        Row: {
          admin_note: string | null
          app_version: string | null
          category: string
          created_at: string
          description: string
          device_info: string | null
          id: string
          platform: string | null
          route: string | null
          screenshot_url: string | null
          severity: string
          status: string
          steps: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          app_version?: string | null
          category: string
          created_at?: string
          description: string
          device_info?: string | null
          id?: string
          platform?: string | null
          route?: string | null
          screenshot_url?: string | null
          severity: string
          status?: string
          steps?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          app_version?: string | null
          category?: string
          created_at?: string
          description?: string
          device_info?: string | null
          id?: string
          platform?: string | null
          route?: string | null
          screenshot_url?: string | null
          severity?: string
          status?: string
          steps?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bug_reports: {
        Row: {
          created_at: string
          description: string | null
          device_info: string | null
          error_message: string
          id: string
          route: string | null
          screenshot_url: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          device_info?: string | null
          error_message: string
          id?: string
          route?: string | null
          screenshot_url?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          device_info?: string | null
          error_message?: string
          id?: string
          route?: string | null
          screenshot_url?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bug_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bug_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      check_ins: {
        Row: {
          created_at: string | null
          id: string
          lane_id: string | null
          status: string | null
          user_id: string | null
          venue_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          lane_id?: string | null
          status?: string | null
          user_id?: string | null
          venue_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          lane_id?: string | null
          status?: string | null
          user_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "lanes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_ins_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      content_reports: {
        Row: {
          content_id: string
          content_type: string
          created_at: string
          details: string | null
          id: string
          post_id: string | null
          reason: string
          reporter_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          content_id: string
          content_type: string
          created_at?: string
          details?: string | null
          id?: string
          post_id?: string | null
          reason: string
          reporter_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          content_id?: string
          content_type?: string
          created_at?: string
          details?: string | null
          id?: string
          post_id?: string | null
          reason?: string
          reporter_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_reports_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string | null
          id: string
          last_message: string | null
          last_message_at: string | null
          participant_1: string
          participant_2: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_message?: string | null
          last_message_at?: string | null
          participant_1: string
          participant_2: string
        }
        Update: {
          created_at?: string | null
          id?: string
          last_message?: string | null
          last_message_at?: string | null
          participant_1?: string
          participant_2?: string
        }
        Relationships: []
      }
      event_rsvps: {
        Row: {
          created_at: string
          event_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "venue_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_rsvps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fantasy_config: {
        Row: {
          full_mode_enabled: boolean
          id: number
          seasons_required: number
          updated_at: string
        }
        Insert: {
          full_mode_enabled?: boolean
          id?: number
          seasons_required?: number
          updated_at?: string
        }
        Update: {
          full_mode_enabled?: boolean
          id?: number
          seasons_required?: number
          updated_at?: string
        }
        Relationships: []
      }
      fantasy_predictions: {
        Row: {
          created_at: string
          id: string
          line: number
          multiplier: number
          payout: number
          pick: string
          result_points: number | null
          settled_at: string | null
          stake: number
          status: string
          team_id: string
          user_id: string
          week_of: string
        }
        Insert: {
          created_at?: string
          id?: string
          line: number
          multiplier: number
          payout?: number
          pick: string
          result_points?: number | null
          settled_at?: string | null
          stake: number
          status?: string
          team_id: string
          user_id: string
          week_of: string
        }
        Update: {
          created_at?: string
          id?: string
          line?: number
          multiplier?: number
          payout?: number
          pick?: string
          result_points?: number | null
          settled_at?: string | null
          stake?: number
          status?: string
          team_id?: string
          user_id?: string
          week_of?: string
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_predictions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_predictions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_predictions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fantasy_roster_players: {
        Row: {
          acquired_at: string
          id: string
          player_user_id: string
          price_paid: number
          roster_id: string
          sell_price: number | null
          sold_at: string | null
        }
        Insert: {
          acquired_at?: string
          id?: string
          player_user_id: string
          price_paid: number
          roster_id: string
          sell_price?: number | null
          sold_at?: string | null
        }
        Update: {
          acquired_at?: string
          id?: string
          player_user_id?: string
          price_paid?: number
          roster_id?: string
          sell_price?: number | null
          sold_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_roster_players_player_user_id_fkey"
            columns: ["player_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_roster_players_player_user_id_fkey"
            columns: ["player_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_roster_players_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "fantasy_rosters"
            referencedColumns: ["id"]
          },
        ]
      }
      fantasy_rosters: {
        Row: {
          budget: number
          created_at: string
          id: string
          season_id: string | null
          user_id: string
        }
        Insert: {
          budget?: number
          created_at?: string
          id?: string
          season_id?: string | null
          user_id: string
        }
        Update: {
          budget?: number
          created_at?: string
          id?: string
          season_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_rosters_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "skeeball_seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_rosters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_rosters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fantasy_transfers: {
        Row: {
          action: string
          created_at: string
          id: string
          player_user_id: string
          price: number
          roster_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          player_user_id: string
          price: number
          roster_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          player_user_id?: string
          price?: number
          roster_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_transfers_player_user_id_fkey"
            columns: ["player_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_transfers_player_user_id_fkey"
            columns: ["player_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_transfers_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "fantasy_rosters"
            referencedColumns: ["id"]
          },
        ]
      }
      fantasy_wallets: {
        Row: {
          balance: number
          created_at: string
          last_stipend_week: string | null
          lifetime_earned: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          last_stipend_week?: string | null
          lifetime_earned?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          last_stipend_week?: string | null
          lifetime_earned?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fantasy_wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fantasy_week_bonuses: {
        Row: {
          awarded_at: string
          awarded_to: string[]
          week_of: string
        }
        Insert: {
          awarded_at?: string
          awarded_to: string[]
          week_of: string
        }
        Update: {
          awarded_at?: string
          awarded_to?: string[]
          week_of?: string
        }
        Relationships: []
      }
      feedback_submissions: {
        Row: {
          app_version: string | null
          category: string
          created_at: string | null
          id: string
          message: string
          rating: number | null
          status: string
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          category: string
          created_at?: string | null
          id?: string
          message: string
          rating?: number | null
          status?: string
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          category?: string
          created_at?: string | null
          id?: string
          message?: string
          rating?: number | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ff_bracket_games: {
        Row: {
          created_at: string
          game_number: number
          group_id: string
          id: string
          status: string
          tournament_id: string
        }
        Insert: {
          created_at?: string
          game_number: number
          group_id: string
          id?: string
          status?: string
          tournament_id: string
        }
        Update: {
          created_at?: string
          game_number?: number
          group_id?: string
          id?: string
          status?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ff_bracket_games_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ff_bracket_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ff_bracket_games_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      ff_bracket_groups: {
        Row: {
          created_at: string
          group_number: number
          id: string
          round_id: string
          status: string
          tournament_id: string
        }
        Insert: {
          created_at?: string
          group_number: number
          id?: string
          round_id: string
          status?: string
          tournament_id: string
        }
        Update: {
          created_at?: string
          group_number?: number
          id?: string
          round_id?: string
          status?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ff_bracket_groups_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "ff_bracket_rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ff_bracket_groups_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      ff_bracket_rounds: {
        Row: {
          created_at: string
          id: string
          round_name: string
          round_number: number
          status: string
          tournament_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          round_name: string
          round_number: number
          status?: string
          tournament_id: string
        }
        Update: {
          created_at?: string
          id?: string
          round_name?: string
          round_number?: number
          status?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ff_bracket_rounds_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      ff_bracket_scores: {
        Row: {
          created_at: string
          game_id: string
          id: string
          is_eliminated: boolean
          player_seed: number | null
          rank_in_game: number | null
          rank_points: number | null
          score: number
          tournament_id: string
          user_id: string | null
          username: string
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          is_eliminated?: boolean
          player_seed?: number | null
          rank_in_game?: number | null
          rank_points?: number | null
          score: number
          tournament_id: string
          user_id?: string | null
          username: string
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          is_eliminated?: boolean
          player_seed?: number | null
          rank_in_game?: number | null
          rank_points?: number | null
          score?: number
          tournament_id?: string
          user_id?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "ff_bracket_scores_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "ff_bracket_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ff_bracket_scores_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      ff_bracket_slots: {
        Row: {
          created_at: string
          eliminated_game: number | null
          final_rank: number | null
          group_id: string
          id: string
          seed: number
          status: string
          tournament_id: string
          user_id: string | null
          username: string
        }
        Insert: {
          created_at?: string
          eliminated_game?: number | null
          final_rank?: number | null
          group_id: string
          id?: string
          seed: number
          status?: string
          tournament_id: string
          user_id?: string | null
          username: string
        }
        Update: {
          created_at?: string
          eliminated_game?: number | null
          final_rank?: number | null
          group_id?: string
          id?: string
          seed?: number
          status?: string
          tournament_id?: string
          user_id?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "ff_bracket_slots_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ff_bracket_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ff_bracket_slots_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string | null
          follower_id: string
          following_id: string
          id: string
        }
        Insert: {
          created_at?: string | null
          follower_id: string
          following_id: string
          id?: string
        }
        Update: {
          created_at?: string | null
          follower_id?: string
          following_id?: string
          id?: string
        }
        Relationships: []
      }
      forum_poll_votes: {
        Row: {
          created_at: string
          option_idx: number
          poll_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          option_idx: number
          poll_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          option_idx?: number
          poll_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "forum_polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_poll_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_poll_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_polls: {
        Row: {
          created_at: string
          id: string
          options: Json
          post_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          options: Json
          post_id: string
        }
        Update: {
          created_at?: string
          id?: string
          options?: Json
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_polls_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_post_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_post_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_post_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_posts: {
        Row: {
          content: string
          created_at: string
          forum_id: string
          id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          forum_id: string
          id?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          forum_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_posts_forum_id_fkey"
            columns: ["forum_id"]
            isOneToOne: false
            referencedRelation: "forums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      forums: {
        Row: {
          auto_flagged: boolean | null
          created_at: string
          creator_id: string | null
          description: string | null
          flag_category: string | null
          game_type: string | null
          id: string
          status: string
          title: string
        }
        Insert: {
          auto_flagged?: boolean | null
          created_at?: string
          creator_id?: string | null
          description?: string | null
          flag_category?: string | null
          game_type?: string | null
          id?: string
          status?: string
          title: string
        }
        Update: {
          auto_flagged?: boolean | null
          created_at?: string
          creator_id?: string | null
          description?: string | null
          flag_category?: string | null
          game_type?: string | null
          id?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "forums_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forums_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          addressee_id: string
          created_at: string | null
          id: string
          requester_id: string
          status: string
        }
        Insert: {
          addressee_id: string
          created_at?: string | null
          id?: string
          requester_id: string
          status?: string
        }
        Update: {
          addressee_id?: string
          created_at?: string | null
          id?: string
          requester_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendships_addressee_id_fkey"
            columns: ["addressee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_addressee_id_fkey"
            columns: ["addressee_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_reference_photos: {
        Row: {
          created_at: string
          game_id: string
          notes: string | null
          storage_path: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          game_id: string
          notes?: string | null
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          game_id?: string
          notes?: string | null
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_reference_photos_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: true
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_reference_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_reference_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          machines_count: number | null
          name: string | null
          type: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          machines_count?: number | null
          name?: string | null
          type?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          machines_count?: number | null
          name?: string | null
          type?: string | null
        }
        Relationships: []
      }
      karaoke_queue: {
        Row: {
          channel: string
          created_at: string | null
          id: string
          requested_by: string | null
          requester_name: string
          status: string
          thumbnail_url: string | null
          title: string
          video_id: string
        }
        Insert: {
          channel?: string
          created_at?: string | null
          id?: string
          requested_by?: string | null
          requester_name?: string
          status?: string
          thumbnail_url?: string | null
          title: string
          video_id: string
        }
        Update: {
          channel?: string
          created_at?: string | null
          id?: string
          requested_by?: string | null
          requester_name?: string
          status?: string
          thumbnail_url?: string | null
          title?: string
          video_id?: string
        }
        Relationships: []
      }
      karaoke_search_cache: {
        Row: {
          created_at: string
          hits: number
          query_norm: string
          results: Json
        }
        Insert: {
          created_at?: string
          hits?: number
          query_norm: string
          results: Json
        }
        Update: {
          created_at?: string
          hits?: number
          query_norm?: string
          results?: Json
        }
        Relationships: []
      }
      lane_qr_tokens: {
        Row: {
          created_at: string | null
          created_by: string | null
          expires_at: string
          id: string
          lane_id: string
          revoked_at: string | null
          token_hash: string
          used_at: string | null
          venue_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          expires_at: string
          id?: string
          lane_id: string
          revoked_at?: string | null
          token_hash: string
          used_at?: string | null
          venue_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          expires_at?: string
          id?: string
          lane_id?: string
          revoked_at?: string | null
          token_hash?: string
          used_at?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lane_qr_tokens_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "lanes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lane_qr_tokens_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      lanes: {
        Row: {
          created_at: string | null
          game_id: string | null
          id: string
          lane_number: number | null
          lane_qr_token: string | null
          qr_token_expires_at: string | null
          qr_token_issued_at: string | null
          status: string | null
          venue_id: string | null
        }
        Insert: {
          created_at?: string | null
          game_id?: string | null
          id?: string
          lane_number?: number | null
          lane_qr_token?: string | null
          qr_token_expires_at?: string | null
          qr_token_issued_at?: string | null
          status?: string | null
          venue_id?: string | null
        }
        Update: {
          created_at?: string | null
          game_id?: string | null
          id?: string
          lane_number?: number | null
          lane_qr_token?: string | null
          qr_token_expires_at?: string | null
          qr_token_issued_at?: string | null
          status?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lanes_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lanes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      league_rsvps: {
        Row: {
          status: string
          team_id: string
          updated_at: string
          user_id: string
          week_of: string
        }
        Insert: {
          status: string
          team_id: string
          updated_at?: string
          user_id: string
          week_of: string
        }
        Update: {
          status?: string
          team_id?: string
          updated_at?: string
          user_id?: string
          week_of?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_rsvps_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_rsvps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_rsvps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      league_teams: {
        Row: {
          id: string
          losses: number | null
          points: number | null
          season_id: string | null
          team_id: string | null
          wins: number | null
        }
        Insert: {
          id?: string
          losses?: number | null
          points?: number | null
          season_id?: string | null
          team_id?: string | null
          wins?: number | null
        }
        Update: {
          id?: string
          losses?: number | null
          points?: number | null
          season_id?: string | null
          team_id?: string | null
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "league_teams_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          created_at: string
          id: string
          scheduled_at: string | null
          season_id: string | null
          status: string
          team_a_id: string | null
          team_b_id: string | null
          week_number: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          scheduled_at?: string | null
          season_id?: string | null
          status?: string
          team_a_id?: string | null
          team_b_id?: string | null
          week_number?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          scheduled_at?: string | null
          season_id?: string | null
          status?: string
          team_a_id?: string | null
          team_b_id?: string | null
          week_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_team_a_id_fkey"
            columns: ["team_a_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_team_b_id_fkey"
            columns: ["team_b_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      media_ownership: {
        Row: {
          bucket_id: string
          path: string
          user_id: string
        }
        Insert: {
          bucket_id: string
          path: string
          user_id: string
        }
        Update: {
          bucket_id?: string
          path?: string
          user_id?: string
        }
        Relationships: []
      }
      menu_items: {
        Row: {
          available: boolean | null
          category: string
          created_at: string | null
          description: string | null
          id: string
          ingredients: string[] | null
          location_slug: string | null
          name: string
          photo_url: string | null
          price: number
        }
        Insert: {
          available?: boolean | null
          category: string
          created_at?: string | null
          description?: string | null
          id?: string
          ingredients?: string[] | null
          location_slug?: string | null
          name: string
          photo_url?: string | null
          price: number
        }
        Update: {
          available?: boolean | null
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          ingredients?: string[] | null
          location_slug?: string | null
          name?: string
          photo_url?: string | null
          price?: number
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string | null
          encrypted_content: string | null
          id: string
          image_url: string | null
          nonce: string | null
          read_by_other: boolean | null
          sender_copy: string | null
          sender_id: string
          sender_nonce: string | null
          sender_public_key: string | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          encrypted_content?: string | null
          id?: string
          image_url?: string | null
          nonce?: string | null
          read_by_other?: boolean | null
          sender_copy?: string | null
          sender_id: string
          sender_nonce?: string | null
          sender_public_key?: string | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          encrypted_content?: string | null
          id?: string
          image_url?: string | null
          nonce?: string | null
          read_by_other?: boolean | null
          sender_copy?: string | null
          sender_id?: string
          sender_nonce?: string | null
          sender_public_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_patterns: {
        Row: {
          active: boolean
          case_sensitive: boolean
          category: string
          id: number
          pattern: string
          severity: number
        }
        Insert: {
          active?: boolean
          case_sensitive?: boolean
          category: string
          id?: number
          pattern: string
          severity?: number
        }
        Update: {
          active?: boolean
          case_sensitive?: boolean
          category?: string
          id?: number
          pattern?: string
          severity?: number
        }
        Relationships: []
      }
      pickem_picks: {
        Row: {
          created_at: string
          team_id: string
          user_id: string
          week_of: string
        }
        Insert: {
          created_at?: string
          team_id: string
          user_id: string
          week_of: string
        }
        Update: {
          created_at?: string
          team_id?: string
          user_id?: string
          week_of?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickem_picks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickem_picks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickem_picks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_likes: {
        Row: {
          created_at: string | null
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_reactions: {
        Row: {
          created_at: string
          emoji: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          content: string
          created_at: string | null
          id: string
          photo_url: string | null
          post_type: string
          score_id: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          photo_url?: string | null
          post_type?: string
          score_id?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          photo_url?: string | null
          post_type?: string
          score_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          equipped_title: string | null
          featured_game_id: string | null
          id: string
          is_admin: boolean
          is_arcade_official: boolean | null
          is_arcade_staff: boolean | null
          is_beta_tester: boolean
          is_private: boolean | null
          last_seen: string | null
          notif_prefs: Json
          onboarding_dismissed: boolean
          online_status: string | null
          phone: string | null
          pronouns: string | null
          role: string
          show_skeeball_stats: boolean
          sub_available: boolean
          tos_accepted_version: string | null
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          equipped_title?: string | null
          featured_game_id?: string | null
          id: string
          is_admin?: boolean
          is_arcade_official?: boolean | null
          is_arcade_staff?: boolean | null
          is_beta_tester?: boolean
          is_private?: boolean | null
          last_seen?: string | null
          notif_prefs?: Json
          onboarding_dismissed?: boolean
          online_status?: string | null
          phone?: string | null
          pronouns?: string | null
          role?: string
          show_skeeball_stats?: boolean
          sub_available?: boolean
          tos_accepted_version?: string | null
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          equipped_title?: string | null
          featured_game_id?: string | null
          id?: string
          is_admin?: boolean
          is_arcade_official?: boolean | null
          is_arcade_staff?: boolean | null
          is_beta_tester?: boolean
          is_private?: boolean | null
          last_seen?: string | null
          notif_prefs?: Json
          onboarding_dismissed?: boolean
          online_status?: string | null
          phone?: string | null
          pronouns?: string | null
          role?: string
          show_skeeball_stats?: boolean
          sub_available?: boolean
          tos_accepted_version?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_featured_game_id_fkey"
            columns: ["featured_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          device_secret_hash: string | null
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          device_secret_hash?: string | null
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          device_secret_hash?: string | null
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_log: {
        Row: {
          action: string
          created_at: string | null
          id: number
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: number
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_limit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_posts: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_posts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      score_corrections: {
        Row: {
          changed_by_user_id: string | null
          created_at: string
          game_id: string | null
          id: string
          new_score: number | null
          old_score: number | null
          reason: string | null
        }
        Insert: {
          changed_by_user_id?: string | null
          created_at?: string
          game_id?: string | null
          id?: string
          new_score?: number | null
          old_score?: number | null
          reason?: string | null
        }
        Update: {
          changed_by_user_id?: string | null
          created_at?: string
          game_id?: string | null
          id?: string
          new_score?: number | null
          old_score?: number | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "score_corrections_changed_by_user_id_fkey"
            columns: ["changed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_corrections_changed_by_user_id_fkey"
            columns: ["changed_by_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      score_disputes: {
        Row: {
          admin_note: string | null
          created_at: string
          id: string
          raised_by: string
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          session_id: string
          status: string
          team_id: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          id?: string
          raised_by: string
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          session_id: string
          status?: string
          team_id: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          id?: string
          raised_by?: string
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          session_id?: string
          status?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "score_disputes_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_disputes_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_disputes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "skeeball_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "score_disputes_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      scores: {
        Row: {
          ai_checked_at: string | null
          ai_confidence: number | null
          ai_read_score: number | null
          ai_reasoning: string | null
          ai_verdict: string | null
          check_in_id: string | null
          created_at: string | null
          frame_data: Json | null
          game_id: string | null
          id: string
          lane_id: string | null
          photo_url: string | null
          proof_storage_path: string | null
          score: number
          season_id: string | null
          status: string
          user_id: string | null
          venue_id: string | null
        }
        Insert: {
          ai_checked_at?: string | null
          ai_confidence?: number | null
          ai_read_score?: number | null
          ai_reasoning?: string | null
          ai_verdict?: string | null
          check_in_id?: string | null
          created_at?: string | null
          frame_data?: Json | null
          game_id?: string | null
          id?: string
          lane_id?: string | null
          photo_url?: string | null
          proof_storage_path?: string | null
          score: number
          season_id?: string | null
          status?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Update: {
          ai_checked_at?: string | null
          ai_confidence?: number | null
          ai_read_score?: number | null
          ai_reasoning?: string | null
          ai_verdict?: string | null
          check_in_id?: string | null
          created_at?: string | null
          frame_data?: Json | null
          game_id?: string | null
          id?: string
          lane_id?: string | null
          photo_url?: string | null
          proof_storage_path?: string | null
          score?: number
          season_id?: string | null
          status?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scores_check_in_id_fkey"
            columns: ["check_in_id"]
            isOneToOne: false
            referencedRelation: "check_ins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_lane_id_fkey"
            columns: ["lane_id"]
            isOneToOne: false
            referencedRelation: "lanes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string
          end_date: string | null
          id: string
          individual_fee_cents: number
          name: string
          prize_1st_cents: number
          prize_2nd_cents: number
          prize_3rd_cents: number
          prize_4th_cents: number
          registration_closes_at: string | null
          registration_opens_at: string | null
          registration_required: boolean
          start_date: string | null
          status: string
          team_fee_cents: number
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          id?: string
          individual_fee_cents?: number
          name: string
          prize_1st_cents?: number
          prize_2nd_cents?: number
          prize_3rd_cents?: number
          prize_4th_cents?: number
          registration_closes_at?: string | null
          registration_opens_at?: string | null
          registration_required?: boolean
          start_date?: string | null
          status?: string
          team_fee_cents?: number
        }
        Update: {
          created_at?: string
          end_date?: string | null
          id?: string
          individual_fee_cents?: number
          name?: string
          prize_1st_cents?: number
          prize_2nd_cents?: number
          prize_3rd_cents?: number
          prize_4th_cents?: number
          registration_closes_at?: string | null
          registration_opens_at?: string | null
          registration_required?: boolean
          start_date?: string | null
          status?: string
          team_fee_cents?: number
        }
        Relationships: []
      }
      security_events: {
        Row: {
          created_at: string | null
          details: Json | null
          event_type: string
          id: string
          ip_address: string | null
          severity: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          details?: Json | null
          event_type: string
          id?: string
          ip_address?: string | null
          severity?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          details?: Json | null
          event_type?: string
          id?: string
          ip_address?: string | null
          severity?: string
          user_id?: string | null
        }
        Relationships: []
      }
      service_quotas: {
        Row: {
          scope: string
          used: number
          window_start: string
        }
        Insert: {
          scope: string
          used: number
          window_start: string
        }
        Update: {
          scope?: string
          used?: number
          window_start?: string
        }
        Relationships: []
      }
      skeeball_ball_scores: {
        Row: {
          ball_number: number
          created_at: string | null
          id: string
          player_user_id: string
          score: number
          session_id: string
        }
        Insert: {
          ball_number: number
          created_at?: string | null
          id?: string
          player_user_id: string
          score: number
          session_id: string
        }
        Update: {
          ball_number?: number
          created_at?: string | null
          id?: string
          player_user_id?: string
          score?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skeeball_ball_scores_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "skeeball_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      skeeball_league_matches: {
        Row: {
          created_at: string | null
          expected_teams: number
          id: string
          notified_at: string | null
          scoring_mode: string | null
          status: string
          week_of: string
        }
        Insert: {
          created_at?: string | null
          expected_teams?: number
          id?: string
          notified_at?: string | null
          scoring_mode?: string | null
          status?: string
          week_of: string
        }
        Update: {
          created_at?: string | null
          expected_teams?: number
          id?: string
          notified_at?: string | null
          scoring_mode?: string | null
          status?: string
          week_of?: string
        }
        Relationships: []
      }
      skeeball_seasons: {
        Row: {
          counts_for_fantasy: boolean
          created_at: string
          created_by: string | null
          end_week: string
          id: string
          name: string
          start_week: string
          status: string
        }
        Insert: {
          counts_for_fantasy?: boolean
          created_at?: string
          created_by?: string | null
          end_week: string
          id?: string
          name: string
          start_week: string
          status?: string
        }
        Update: {
          counts_for_fantasy?: boolean
          created_at?: string
          created_by?: string | null
          end_week?: string
          id?: string
          name?: string
          start_week?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "skeeball_seasons_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skeeball_seasons_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      skeeball_session_players: {
        Row: {
          created_at: string
          player_user_id: string
          session_id: string
          shoot_position: number | null
        }
        Insert: {
          created_at?: string
          player_user_id: string
          session_id: string
          shoot_position?: number | null
        }
        Update: {
          created_at?: string
          player_user_id?: string
          session_id?: string
          shoot_position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "skeeball_session_players_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "skeeball_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      skeeball_sessions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string
          game_number: number
          id: string
          lane_number: number
          last_activity_at: string | null
          league_match_id: string | null
          league_points: number | null
          league_points_adjustment: number
          placement: number | null
          score_adjustment: number
          status: string
          team_id: string
          week_of: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by: string
          game_number?: number
          id?: string
          lane_number: number
          last_activity_at?: string | null
          league_match_id?: string | null
          league_points?: number | null
          league_points_adjustment?: number
          placement?: number | null
          score_adjustment?: number
          status?: string
          team_id: string
          week_of: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string
          game_number?: number
          id?: string
          lane_number?: number
          last_activity_at?: string | null
          league_match_id?: string | null
          league_points?: number | null
          league_points_adjustment?: number
          placement?: number | null
          score_adjustment?: number
          status?: string
          team_id?: string
          week_of?: string
        }
        Relationships: [
          {
            foreignKeyName: "skeeball_sessions_league_match_id_fkey"
            columns: ["league_match_id"]
            isOneToOne: false
            referencedRelation: "skeeball_league_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skeeball_sessions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      square_payment_statuses: {
        Row: {
          created_at: string
          event_type: string
          id: string
          last_event_id: string
          provider_updated_at: string | null
          raw_event: Json
          square_order_id: string | null
          square_payment_id: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          last_event_id: string
          provider_updated_at?: string | null
          raw_event: Json
          square_order_id?: string | null
          square_payment_id?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          last_event_id?: string
          provider_updated_at?: string | null
          raw_event?: Json
          square_order_id?: string | null
          square_payment_id?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      square_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          id: string
          merchant_id: string | null
          payload: Json
          processed_at: string | null
          received_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          id?: string
          merchant_id?: string | null
          payload: Json
          processed_at?: string | null
          received_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          id?: string
          merchant_id?: string | null
          payload?: Json
          processed_at?: string | null
          received_at?: string
        }
        Relationships: []
      }
      storage_cleanup_queue: {
        Row: {
          bucket: string
          created_at: string | null
          id: string
          path: string
          processed_at: string | null
          reason: string | null
        }
        Insert: {
          bucket: string
          created_at?: string | null
          id?: string
          path: string
          processed_at?: string | null
          reason?: string | null
        }
        Update: {
          bucket?: string
          created_at?: string | null
          id?: string
          path?: string
          processed_at?: string | null
          reason?: string | null
        }
        Relationships: []
      }
      sub_requests: {
        Row: {
          created_at: string
          filled_by: string | null
          id: string
          note: string | null
          requested_by: string
          status: string
          team_id: string
          week_of: string
        }
        Insert: {
          created_at?: string
          filled_by?: string | null
          id?: string
          note?: string | null
          requested_by: string
          status?: string
          team_id: string
          week_of: string
        }
        Update: {
          created_at?: string
          filled_by?: string | null
          id?: string
          note?: string | null
          requested_by?: string
          status?: string
          team_id?: string
          week_of?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_requests_filled_by_fkey"
            columns: ["filled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_requests_filled_by_fkey"
            columns: ["filled_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_requests_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          is_admin_msg: boolean
          is_read: boolean
          sender_id: string
          ticket_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          is_admin_msg?: boolean
          is_read?: boolean
          sender_id: string
          ticket_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          is_admin_msg?: boolean
          is_read?: boolean
          sender_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          created_at: string | null
          email_sent: boolean
          id: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email_sent?: boolean
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          email_sent?: boolean
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      team_announcements: {
        Row: {
          content: string
          created_at: string | null
          id: string
          team_id: string | null
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          team_id?: string | null
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          team_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_announcements_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_bans: {
        Row: {
          banned_by: string
          created_at: string
          id: string
          team_id: string
          user_id: string
        }
        Insert: {
          banned_by: string
          created_at?: string
          id?: string
          team_id: string
          user_id: string
        }
        Update: {
          banned_by?: string
          created_at?: string
          id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_bans_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          id: string
          role: string
          team_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          team_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          team_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          team_id: string | null
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          team_id?: string | null
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          team_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_messages_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_registrations: {
        Row: {
          checkout_url: string | null
          created_at: string
          expected_amount_cents: number | null
          expected_currency: string | null
          id: string
          paid_at: string | null
          registration_type: string
          season_id: string
          square_location_id: string | null
          square_order_id: string | null
          square_payment_link_id: string | null
          status: string
          team_id: string | null
          user_id: string
        }
        Insert: {
          checkout_url?: string | null
          created_at?: string
          expected_amount_cents?: number | null
          expected_currency?: string | null
          id?: string
          paid_at?: string | null
          registration_type: string
          season_id: string
          square_location_id?: string | null
          square_order_id?: string | null
          square_payment_link_id?: string | null
          status?: string
          team_id?: string | null
          user_id: string
        }
        Update: {
          checkout_url?: string | null
          created_at?: string
          expected_amount_cents?: number | null
          expected_currency?: string | null
          id?: string
          paid_at?: string | null
          registration_type?: string
          season_id?: string
          square_location_id?: string | null
          square_order_id?: string | null
          square_payment_link_id?: string | null
          status?: string
          team_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_registrations_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_registrations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_registrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_registrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_requests: {
        Row: {
          created_at: string | null
          direction: string
          id: string
          message: string | null
          status: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          direction: string
          id?: string
          message?: string | null
          status?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          direction?: string
          id?: string
          message?: string | null
          status?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_requests_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_schedule: {
        Row: {
          created_at: string | null
          id: string
          slot_time: string
          team_id: string | null
          week_label: string
          week_of: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          slot_time: string
          team_id?: string | null
          week_label: string
          week_of?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          slot_time?: string
          team_id?: string | null
          week_label?: string
          week_of?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_schedule_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          captain_user_id: string | null
          created_at: string
          id: string
          name: string
          photo_url: string | null
          season_id: string | null
          slot_pref_1: string | null
          slot_pref_2: string | null
          venue_id: string | null
        }
        Insert: {
          captain_user_id?: string | null
          created_at?: string
          id?: string
          name: string
          photo_url?: string | null
          season_id?: string | null
          slot_pref_1?: string | null
          slot_pref_2?: string | null
          venue_id?: string | null
        }
        Update: {
          captain_user_id?: string | null
          created_at?: string
          id?: string
          name?: string
          photo_url?: string | null
          season_id?: string | null
          slot_pref_1?: string | null
          slot_pref_2?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_captain_user_id_fkey"
            columns: ["captain_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_captain_user_id_fkey"
            columns: ["captain_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      throws: {
        Row: {
          created_at: string
          game_id: string | null
          id: string
          score: number
          source: string
          throw_number: number
        }
        Insert: {
          created_at?: string
          game_id?: string | null
          id?: string
          score: number
          source?: string
          throw_number: number
        }
        Update: {
          created_at?: string
          game_id?: string | null
          id?: string
          score?: number
          source?: string
          throw_number?: number
        }
        Relationships: []
      }
      tournament_placements: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          placement: number
          tournament_id: string
          user_id: string | null
          username: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          placement: number
          tournament_id: string
          user_id?: string | null
          username?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          placement?: number
          tournament_id?: string
          user_id?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_placements_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_registrations: {
        Row: {
          created_at: string
          guest_name: string | null
          id: string
          status: string
          team_name: string | null
          tournament_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          guest_name?: string | null
          id?: string
          status?: string
          team_name?: string | null
          tournament_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          guest_name?: string | null
          id?: string
          status?: string
          team_name?: string | null
          tournament_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_registrations_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_registrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_registrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_requests: {
        Row: {
          admin_note: string | null
          created_at: string
          description: string | null
          game_type: string | null
          id: string
          max_teams: number
          proposed_date: string | null
          status: string
          title: string
          user_id: string | null
          venue_id: string | null
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          description?: string | null
          game_type?: string | null
          id?: string
          max_teams?: number
          proposed_date?: string | null
          status?: string
          title: string
          user_id?: string | null
          venue_id?: string | null
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          description?: string | null
          game_type?: string | null
          id?: string
          max_teams?: number
          proposed_date?: string | null
          status?: string
          title?: string
          user_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_requests_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_results: {
        Row: {
          created_at: string | null
          id: string
          place: number
          tournament_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          place: number
          tournament_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          place?: number
          tournament_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_results_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_results_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_results_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          announcement: string | null
          announcement_updated_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          ff_signup_time: string | null
          ff_start_time: string | null
          game_type: string | null
          id: string
          is_individual: boolean
          is_official: boolean
          max_players: number | null
          max_teams: number | null
          proposed_date: string | null
          signup_qr_active: boolean
          signup_qr_issued_at: string | null
          signup_qr_token: string | null
          signup_type: string
          status: string
          title: string
          venue_id: string | null
        }
        Insert: {
          announcement?: string | null
          announcement_updated_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ff_signup_time?: string | null
          ff_start_time?: string | null
          game_type?: string | null
          id?: string
          is_individual?: boolean
          is_official?: boolean
          max_players?: number | null
          max_teams?: number | null
          proposed_date?: string | null
          signup_qr_active?: boolean
          signup_qr_issued_at?: string | null
          signup_qr_token?: string | null
          signup_type?: string
          status?: string
          title: string
          venue_id?: string | null
        }
        Update: {
          announcement?: string | null
          announcement_updated_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ff_signup_time?: string | null
          ff_start_time?: string | null
          game_type?: string | null
          id?: string
          is_individual?: boolean
          is_official?: boolean
          max_players?: number | null
          max_teams?: number | null
          proposed_date?: string | null
          signup_qr_active?: boolean
          signup_qr_issued_at?: string | null
          signup_qr_token?: string | null
          signup_type?: string
          status?: string
          title?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournaments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      trivia_answers: {
        Row: {
          answer_text: string | null
          game_id: string
          id: string
          is_correct: boolean | null
          participant_id: string
          points_awarded: number
          question_id: string
          submitted_at: string
        }
        Insert: {
          answer_text?: string | null
          game_id: string
          id?: string
          is_correct?: boolean | null
          participant_id: string
          points_awarded?: number
          question_id: string
          submitted_at?: string
        }
        Update: {
          answer_text?: string | null
          game_id?: string
          id?: string
          is_correct?: boolean | null
          participant_id?: string
          points_awarded?: number
          question_id?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trivia_answers_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "trivia_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trivia_answers_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "trivia_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trivia_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "trivia_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      trivia_events: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          event_date: string | null
          id: string
          signup_deadline: string
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          event_date?: string | null
          id?: string
          signup_deadline: string
          status?: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          event_date?: string | null
          id?: string
          signup_deadline?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "trivia_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trivia_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trivia_game_questions: {
        Row: {
          game_id: string
          question_id: string
          question_order: number
        }
        Insert: {
          game_id: string
          question_id: string
          question_order: number
        }
        Update: {
          game_id?: string
          question_id?: string
          question_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "trivia_game_questions_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "trivia_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trivia_game_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "trivia_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      trivia_games: {
        Row: {
          allow_teams: boolean
          created_at: string
          created_by: string | null
          current_question_id: string | null
          current_question_index: number
          ended_at: string | null
          id: string
          max_participants: number
          min_team_size: number
          signup_token: string
          started_at: string | null
          status: string
          title: string
        }
        Insert: {
          allow_teams?: boolean
          created_at?: string
          created_by?: string | null
          current_question_id?: string | null
          current_question_index?: number
          ended_at?: string | null
          id?: string
          max_participants?: number
          min_team_size?: number
          signup_token?: string
          started_at?: string | null
          status?: string
          title?: string
        }
        Update: {
          allow_teams?: boolean
          created_at?: string
          created_by?: string | null
          current_question_id?: string | null
          current_question_index?: number
          ended_at?: string | null
          id?: string
          max_participants?: number
          min_team_size?: number
          signup_token?: string
          started_at?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "trivia_games_current_question_id_fkey"
            columns: ["current_question_id"]
            isOneToOne: false
            referencedRelation: "trivia_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      trivia_participants: {
        Row: {
          created_at: string
          display_name: string
          game_id: string
          id: string
          participant_type: string
          score: number
          team_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          game_id: string
          id?: string
          participant_type: string
          score?: number
          team_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          game_id?: string
          id?: string
          participant_type?: string
          score?: number
          team_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trivia_participants_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "trivia_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trivia_participants_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      trivia_questions: {
        Row: {
          category: string | null
          correct_answer: string
          created_at: string
          created_by: string | null
          id: string
          options: Json | null
          points: number
          question: string
          question_type: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          correct_answer: string
          created_at?: string
          created_by?: string | null
          id?: string
          options?: Json | null
          points?: number
          question: string
          question_type?: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          correct_answer?: string
          created_at?: string
          created_by?: string | null
          id?: string
          options?: Json | null
          points?: number
          question?: string
          question_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      trivia_team_members: {
        Row: {
          created_at: string
          id: string
          trivia_team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          trivia_team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          trivia_team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trivia_team_members_trivia_team_id_fkey"
            columns: ["trivia_team_id"]
            isOneToOne: false
            referencedRelation: "trivia_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trivia_team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trivia_team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trivia_teams: {
        Row: {
          captain_user_id: string
          created_at: string
          event_id: string
          id: string
          team_name: string
        }
        Insert: {
          captain_user_id: string
          created_at?: string
          event_id: string
          id?: string
          team_name: string
        }
        Update: {
          captain_user_id?: string
          created_at?: string
          event_id?: string
          id?: string
          team_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "trivia_teams_captain_user_id_fkey"
            columns: ["captain_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trivia_teams_captain_user_id_fkey"
            columns: ["captain_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trivia_teams_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "trivia_events"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_public_keys: {
        Row: {
          created_at: string | null
          public_key: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          public_key: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          public_key?: string
          user_id?: string
        }
        Relationships: []
      }
      user_titles: {
        Row: {
          granted_at: string
          source: string | null
          title_key: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          source?: string | null
          title_key: string
          user_id: string
        }
        Update: {
          granted_at?: string
          source?: string | null
          title_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_titles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_titles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_admins: {
        Row: {
          granted_at: string | null
          granted_by: string | null
          id: string
          role: string
          user_id: string
          venue_id: string
        }
        Insert: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          role?: string
          user_id: string
          venue_id: string
        }
        Update: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          role?: string
          user_id?: string
          venue_id?: string
        }
        Relationships: []
      }
      venue_events: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          event_type: string
          id: string
          starts_at: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          event_type?: string
          id?: string
          starts_at: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          event_type?: string
          id?: string
          starts_at?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string | null
          color: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          address?: string | null
          color?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          address?: string | null
          color?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_profiles: {
        Row: {
          avatar_url: string | null
          badge_role: string | null
          bio: string | null
          created_at: string | null
          equipped_title: string | null
          featured_game_id: string | null
          id: string | null
          is_beta_tester: boolean | null
          online_status: string | null
          pronouns: string | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          badge_role?: never
          bio?: never
          created_at?: string | null
          equipped_title?: string | null
          featured_game_id?: never
          id?: string | null
          is_beta_tester?: never
          online_status?: never
          pronouns?: string | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          badge_role?: never
          bio?: never
          created_at?: string | null
          equipped_title?: string | null
          featured_game_id?: never
          id?: string | null
          is_beta_tester?: never
          online_status?: never
          pronouns?: string | null
          username?: string | null
        }
        Relationships: []
      }
      skeeball_league_standings: {
        Row: {
          bronze: number | null
          gold: number | null
          matches_played: number | null
          silver: number | null
          team_id: string | null
          team_name: string | null
          total_points: number | null
        }
        Relationships: [
          {
            foreignKeyName: "skeeball_sessions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      account_storage_inventory: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          bucket_id: string
          name: string
        }[]
      }
      all_title_keys: { Args: never; Returns: string[] }
      can_manage_venue: { Args: { p_venue_id: string }; Returns: boolean }
      check_and_log_rate_limit: {
        Args: {
          p_action: string
          p_max_count: number
          p_window_seconds: number
        }
        Returns: undefined
      }
      check_content_moderation: { Args: { p_text: string }; Returns: Json }
      check_email_available: { Args: { p_email: string }; Returns: boolean }
      check_username_available: {
        Args: { p_username: string }
        Returns: boolean
      }
      consume_service_quota: {
        Args: { p_limit: number; p_scope: string; p_seconds: number }
        Returns: boolean
      }
      delete_account_data: { Args: { p_user_id: string }; Returns: undefined }
      fantasy_full_mode: { Args: never; Returns: boolean }
      fantasy_line_multiplier: {
        Args: { p_line: number; p_pick: string; p_team_id: string }
        Returns: number
      }
      fantasy_settle_pending: { Args: never; Returns: undefined }
      fantasy_team_week_points: {
        Args: { p_team_id: string; p_week: string }
        Returns: number
      }
      fantasy_week_locked: { Args: { p_week: string }; Returns: boolean }
      get_email_by_username: { Args: { p_username: string }; Returns: string }
      get_username_by_email: { Args: { p_email: string }; Returns: string }
      hash_lane_token: { Args: { p_raw: string }; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_arcade_official: { Args: never; Returns: boolean }
      is_owner_or_architect: { Args: never; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_venue_admin: { Args: { p_venue_id: string }; Returns: boolean }
      is_venue_owner: { Args: { p_venue_id: string }; Returns: boolean }
      is_venue_staff: { Args: { p_venue_id: string }; Returns: boolean }
      log_payment_security_event: {
        Args: { p_details?: Json; p_event_type: string }
        Returns: undefined
      }
      log_security_event: {
        Args: { p_details?: Json; p_event_type: string; p_severity?: string }
        Returns: undefined
      }
      process_square_webhook: {
        Args: {
          p_event: Json
          p_order: Json
          p_payment: Json
          p_verified_paid: boolean
        }
        Returns: Json
      }
      qr_token_fingerprint: { Args: { p_raw: string }; Returns: string }
      register_device_push_token: {
        Args: { p_platform: string; p_secret: string; p_token: string }
        Returns: undefined
      }
      require_mfa: { Args: never; Returns: undefined }
      resolve_login_email: { Args: { p_username: string }; Returns: string }
      rpc_accept_tos: { Args: { p_version: string }; Returns: Json }
      rpc_admin_add_ff_guest: {
        Args: { p_guest_name: string; p_tournament_id: string }
        Returns: Json
      }
      rpc_admin_adjust_skeeball_session: {
        Args: {
          p_league_points_adjustment: number
          p_note?: string
          p_score_adjustment: number
          p_session_id: string
        }
        Returns: Json
      }
      rpc_admin_approve_tournament: {
        Args: { p_request_id: string }
        Returns: Json
      }
      rpc_admin_assign_team_member: {
        Args: { p_team_id: string; p_user_id: string }
        Returns: Json
      }
      rpc_admin_broadcast: {
        Args: { p_body: string; p_days?: number; p_title: string }
        Returns: Json
      }
      rpc_admin_bulk_create_teams: {
        Args: { p_names: string[]; p_venue_id?: string }
        Returns: Json
      }
      rpc_admin_create_first_friday: {
        Args: { p_date: string; p_label: string; p_venue_id?: string }
        Returns: Json
      }
      rpc_admin_create_score_proof_signed_url: {
        Args: { p_score_id: string }
        Returns: Json
      }
      rpc_admin_delete_season_data: {
        Args: { p_season_id: string }
        Returns: Json
      }
      rpc_admin_delete_team: { Args: { p_team_id: string }; Returns: Json }
      rpc_admin_delete_tournament: {
        Args: { p_tournament_id: string }
        Returns: Json
      }
      rpc_admin_deny_tournament: {
        Args: { p_note?: string; p_request_id: string }
        Returns: Json
      }
      rpc_admin_fantasy_set_full_mode: {
        Args: { p_enabled: boolean }
        Returns: Json
      }
      rpc_admin_fantasy_set_season_counts: {
        Args: { p_counts: boolean; p_season_id: string }
        Returns: Json
      }
      rpc_admin_generate_ff_signup_qr: {
        Args: { p_tournament_id: string }
        Returns: Json
      }
      rpc_admin_generate_lane_qr_token: {
        Args: { p_lane_id: string; p_ttl_hours?: number }
        Returns: Json
      }
      rpc_admin_get_audit_log: { Args: { p_limit?: number }; Returns: Json }
      rpc_admin_get_beta_reports: { Args: { p_status?: string }; Returns: Json }
      rpc_admin_get_content_reports: {
        Args: { p_status?: string }
        Returns: Json
      }
      rpc_admin_get_score_review_queue: {
        Args: { p_status?: string; p_venue_id?: string }
        Returns: Json
      }
      rpc_admin_get_security_events: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_severity?: string
          p_type?: string
        }
        Returns: {
          created_at: string
          details: Json
          event_type: string
          id: string
          severity: string
          user_id: string
          username: string
        }[]
      }
      rpc_admin_get_storage_cleanup_queue: {
        Args: { p_limit?: number }
        Returns: {
          bucket: string
          created_at: string
          id: string
          path: string
          reason: string
        }[]
      }
      rpc_admin_get_team_join_requests: {
        Args: { p_team_id: string }
        Returns: {
          avatar_url: string
          created_at: string
          message: string
          request_id: string
          team_id: string
          user_id: string
          username: string
        }[]
      }
      rpc_admin_get_team_members: {
        Args: { p_team_id: string }
        Returns: {
          avatar_url: string
          joined_at: string
          role: string
          user_id: string
          username: string
        }[]
      }
      rpc_admin_get_users: {
        Args: never
        Returns: {
          avatar_url: string
          email: string
          id: string
          is_beta_tester: boolean
          role: string
          username: string
        }[]
      }
      rpc_admin_grant_title_to_beta: {
        Args: { p_title_key: string }
        Returns: Json
      }
      rpc_admin_grant_venue_role: {
        Args: { p_role: string; p_user_id: string; p_venue_id: string }
        Returns: Json
      }
      rpc_admin_mark_storage_cleaned: {
        Args: { p_ids: string[] }
        Returns: undefined
      }
      rpc_admin_remove_ff_guest: { Args: { p_reg_id: string }; Returns: Json }
      rpc_admin_remove_team_member: {
        Args: { p_team_id: string; p_user_id: string }
        Returns: Json
      }
      rpc_admin_remove_tournament_player: {
        Args: { p_reg_id: string }
        Returns: Json
      }
      rpc_admin_reply_support: {
        Args: { p_content: string; p_ticket_id: string }
        Returns: Json
      }
      rpc_admin_reset_all_league_data: {
        Args: { p_delete_teams?: boolean }
        Returns: Json
      }
      rpc_admin_reset_team_data: {
        Args: { p_delete_team?: boolean; p_team_id: string }
        Returns: Json
      }
      rpc_admin_resolve_content_report: {
        Args: { p_action: string; p_report_id: string }
        Returns: Json
      }
      rpc_admin_resolve_dispute: {
        Args: { p_action: string; p_dispute_id: string; p_note?: string }
        Returns: Json
      }
      rpc_admin_resolve_team_request: {
        Args: { p_action: string; p_request_id: string }
        Returns: Json
      }
      rpc_admin_review_score: {
        Args: { p_score_id: string; p_status: string }
        Returns: Json
      }
      rpc_admin_revoke_ff_signup_qr: {
        Args: { p_tournament_id: string }
        Returns: Json
      }
      rpc_admin_revoke_venue_role: {
        Args: { p_user_id: string; p_venue_id: string }
        Returns: Json
      }
      rpc_admin_rotate_lane_token: {
        Args: { p_lane_id: string }
        Returns: Json
      }
      rpc_admin_save_placements: {
        Args: { p_placements: Json; p_tournament_id: string }
        Returns: Json
      }
      rpc_admin_set_ai_verification_mode: {
        Args: { p_mode: string }
        Returns: Json
      }
      rpc_admin_set_beta_open: { Args: { p_open: boolean }; Returns: Json }
      rpc_admin_set_beta_tester: {
        Args: { p_enabled: boolean; p_user_id: string }
        Returns: Json
      }
      rpc_admin_set_team_captain: {
        Args: { p_team_id: string; p_user_id: string }
        Returns: Json
      }
      rpc_admin_set_tournament_status: {
        Args: { p_status: string; p_tournament_id: string }
        Returns: Json
      }
      rpc_admin_skeeball_force_finalize: {
        Args: { p_match_id: string }
        Returns: Json
      }
      rpc_admin_skeeball_kick_session: {
        Args: { p_session_id: string }
        Returns: Json
      }
      rpc_admin_skeeball_set_match_order: {
        Args: { p_match_id: string; p_ordered_session_ids: string[] }
        Returns: Json
      }
      rpc_admin_skeeball_set_scoring_mode: {
        Args: { p_mode: string; p_week_of?: string }
        Returns: Json
      }
      rpc_admin_skeeball_set_week_teams: {
        Args: { p_expected_teams: number; p_week_of?: string }
        Returns: Json
      }
      rpc_admin_skeeball_start_season: {
        Args: { p_name: string }
        Returns: Json
      }
      rpc_admin_trivia_create_game: {
        Args: {
          p_allow_teams: boolean
          p_max_participants: number
          p_min_team_size: number
          p_question_ids: string[]
          p_title: string
        }
        Returns: Json
      }
      rpc_admin_trivia_delete_game: {
        Args: { p_game_id: string }
        Returns: Json
      }
      rpc_admin_trivia_end_game: { Args: { p_game_id: string }; Returns: Json }
      rpc_admin_trivia_grade: {
        Args: { p_answer_id: string; p_is_correct: boolean }
        Returns: Json
      }
      rpc_admin_trivia_next_question: {
        Args: { p_game_id: string }
        Returns: Json
      }
      rpc_admin_trivia_start_game: {
        Args: { p_game_id: string }
        Returns: Json
      }
      rpc_admin_update_beta_report: {
        Args: { p_admin_note?: string; p_id: string; p_status: string }
        Returns: Json
      }
      rpc_admin_update_forum_status: {
        Args: { p_forum_id: string; p_status: string }
        Returns: Json
      }
      rpc_admin_update_tournament: {
        Args: {
          p_game_type?: string
          p_max_players?: number
          p_proposed_date?: string
          p_signup_time?: string
          p_start_time?: string
          p_title?: string
          p_tournament_id: string
        }
        Returns: Json
      }
      rpc_architect_report: { Args: never; Returns: Json }
      rpc_attach_score_proof: {
        Args: { p_score_id: string; p_storage_path: string }
        Returns: Json
      }
      rpc_beta_submit_report: {
        Args: {
          p_app_version?: string
          p_category: string
          p_description: string
          p_device_info?: string
          p_platform?: string
          p_route?: string
          p_screenshot_url?: string
          p_severity: string
          p_steps?: string
          p_title: string
        }
        Returns: Json
      }
      rpc_cancel_sub: { Args: { p_request_id: string }; Returns: Json }
      rpc_check_in: { Args: { p_token: string }; Returns: Json }
      rpc_claim_sub: { Args: { p_request_id: string }; Returns: Json }
      rpc_fantasy_buy_player: {
        Args: { p_player_user_id: string }
        Returns: Json
      }
      rpc_fantasy_cancel_prediction: { Args: { p_id: string }; Returns: Json }
      rpc_fantasy_get_state: { Args: never; Returns: Json }
      rpc_fantasy_market: { Args: never; Returns: Json }
      rpc_fantasy_place_prediction: {
        Args: {
          p_line: number
          p_pick: string
          p_stake: number
          p_team_id: string
        }
        Returns: Json
      }
      rpc_fantasy_sell_player: {
        Args: { p_player_user_id: string }
        Returns: Json
      }
      rpc_feed_page: {
        Args: {
          p_before?: string
          p_before_id?: string
          p_limit?: number
          p_tab?: string
        }
        Returns: Json[]
      }
      rpc_ff_generate_bracket: {
        Args: { p_tournament_id: string }
        Returns: Json
      }
      rpc_ff_get_bracket: { Args: { p_tournament_id: string }; Returns: Json }
      rpc_ff_get_guest_players: {
        Args: { p_tournament_id: string }
        Returns: Json
      }
      rpc_ff_qr_signup: { Args: { p_token: string }; Returns: Json }
      rpc_ff_submit_game_scores: {
        Args: { p_game_id: string; p_scores: Json }
        Returns: Json
      }
      rpc_get_my_titles: { Args: never; Returns: Json }
      rpc_get_public_profile: { Args: { p_user_id: string }; Returns: Json }
      rpc_get_score_proof_url: { Args: { p_score_id: string }; Returns: string }
      rpc_karaoke_add: {
        Args: {
          p_channel?: string
          p_requester_name?: string
          p_thumbnail_url?: string
          p_title: string
          p_video_id: string
        }
        Returns: Json
      }
      rpc_karaoke_clear_history: { Args: never; Returns: Json }
      rpc_karaoke_next: { Args: { p_current_id?: string }; Returns: Json }
      rpc_karaoke_remove: { Args: { p_song_id: string }; Returns: Json }
      rpc_karaoke_skip: { Args: { p_song_id: string }; Returns: Json }
      rpc_make_pick: { Args: { p_team_id: string }; Returns: Json }
      rpc_most_played_game: { Args: never; Returns: Json }
      rpc_my_skeeball_night: { Args: { p_week_of?: string }; Returns: Json }
      rpc_my_team_rsvps: { Args: never; Returns: Json }
      rpc_owner_metrics: { Args: never; Returns: Json }
      rpc_pickem_leaderboard: {
        Args: { p_end?: string; p_start?: string }
        Returns: Json
      }
      rpc_public_score_card: { Args: { p_score_id: string }; Returns: Json }
      rpc_public_standings: { Args: never; Returns: Json }
      rpc_raise_score_dispute: {
        Args: { p_reason: string; p_session_id: string }
        Returns: Json
      }
      rpc_report_content: {
        Args: {
          p_content_id: string
          p_content_type: string
          p_details?: string
          p_reason: string
        }
        Returns: Json
      }
      rpc_request_sub: {
        Args: { p_note?: string; p_team_id: string; p_week_of: string }
        Returns: Json
      }
      rpc_resolve_support_ticket: {
        Args: { p_ticket_id: string }
        Returns: Json
      }
      rpc_send_support_message: { Args: { p_content: string }; Returns: Json }
      rpc_set_league_rsvp: { Args: { p_status: string }; Returns: Json }
      rpc_skeeball_cancel_session: {
        Args: { p_force?: boolean; p_session_id: string }
        Returns: Json
      }
      rpc_skeeball_complete_session: {
        Args: { p_session_id: string }
        Returns: Json
      }
      rpc_skeeball_finalize_match: {
        Args: { p_force?: boolean; p_match_id: string }
        Returns: Json
      }
      rpc_skeeball_get_or_create_match: {
        Args: { p_week_of: string }
        Returns: Json
      }
      rpc_skeeball_hall_of_fame: { Args: never; Returns: Json }
      rpc_skeeball_head_to_head: {
        Args: {
          p_end?: string
          p_opponent_id: string
          p_start?: string
          p_team_id: string
        }
        Returns: Json
      }
      rpc_skeeball_player_insights: {
        Args: { p_end?: string; p_start?: string; p_user_id: string }
        Returns: Json
      }
      rpc_skeeball_player_stats: {
        Args: { p_end?: string; p_start?: string; p_user_id: string }
        Returns: Json
      }
      rpc_skeeball_position_stats: {
        Args: { p_end?: string; p_start?: string; p_team_id: string }
        Returns: Json
      }
      rpc_skeeball_preview_lane_qr: { Args: { p_token: string }; Returns: Json }
      rpc_skeeball_recap_data: {
        Args: { p_end?: string; p_start?: string; p_team_id: string }
        Returns: Json
      }
      rpc_skeeball_set_lineup_order: {
        Args: { p_ordered_user_ids: string[]; p_session_id: string }
        Returns: Json
      }
      rpc_skeeball_standings: {
        Args: { p_end?: string; p_start?: string }
        Returns: Json
      }
      rpc_skeeball_start_qr_session: {
        Args: { p_team_id: string; p_token: string }
        Returns: Json
      }
      rpc_skeeball_submit_and_complete: {
        Args: { p_balls: Json; p_session_id: string }
        Returns: Json
      }
      rpc_skeeball_submit_balls: {
        Args: { p_balls: Json; p_session_id: string }
        Returns: Json
      }
      rpc_skeeball_swap_session_player: {
        Args: {
          p_in_user_id: string
          p_out_user_id: string
          p_session_id: string
        }
        Returns: Json
      }
      rpc_skeeball_team_high_scores: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          rank: number
          team_id: string
          team_name: string
          total_score: number
          week_of: string
        }[]
      }
      rpc_skeeball_team_stats: {
        Args: { p_end?: string; p_start?: string; p_team_id: string }
        Returns: Json
      }
      rpc_skeeball_team_week_history: {
        Args: { p_end?: string; p_start?: string; p_team_id: string }
        Returns: Json
      }
      rpc_skeeball_week_scoring_mode: {
        Args: { p_week_of?: string }
        Returns: Json
      }
      rpc_skeeball_weekly_awards: {
        Args: { p_end?: string; p_start?: string }
        Returns: Json
      }
      rpc_submit_feedback: {
        Args: {
          p_app_version?: string
          p_category: string
          p_message: string
          p_rating?: number
        }
        Returns: Json
      }
      rpc_submit_score: {
        Args: {
          p_check_in_id: string
          p_frame_data?: Json
          p_game_id: string
          p_lane_id: string
          p_score: number
          p_venue_id: string
        }
        Returns: Json
      }
      rpc_team_ban: {
        Args: { p_member_id: string; p_team_id: string }
        Returns: Json
      }
      rpc_team_kick: {
        Args: { p_member_id: string; p_team_id: string }
        Returns: Json
      }
      rpc_team_unban: {
        Args: { p_member_id: string; p_team_id: string }
        Returns: Json
      }
      rpc_trivia_join: {
        Args: { p_game_id: string; p_team_id?: string }
        Returns: Json
      }
      rpc_trivia_submit_answer: {
        Args: { p_answer: string; p_game_id: string; p_question_id: string }
        Returns: Json
      }
      set_user_role: {
        Args: { new_role: string; target_user_id: string }
        Returns: undefined
      }
      skeeball_current_week: { Args: never; Returns: string }
      skeeball_lane_from_token: {
        Args: { p_token: string }
        Returns: {
          game_id: string
          game_name: string
          game_type: string
          lane_id: string
          lane_number: number
          lane_status: string
          token_error: string
          venue_id: string
        }[]
      }
      skeeball_season_week_number: { Args: { p_week: string }; Returns: number }
      user_earned_title_keys: { Args: { p_uid: string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
