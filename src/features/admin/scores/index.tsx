// Security: admin check is UX-only. All mutations use SECURITY DEFINER RPCs that enforce MFA + is_admin() server-side.

/**
 * ScoreReviewPanel
 *
 * Hosts the score review queue, approve/deny UI, photo proof modal,
 * confirmation dialogs, and score stats/health data loading.
 *
 * All Supabase calls for this feature live in src/app/admin.tsx.
 * This module exports the types used by that screen.
 *
 * Relevant functions in admin.tsx:
 *   loadReviews()         — fetches scores by status tab
 *   handleDirectApprove() — approve without confirm dialog
 *   requestConfirm()      — opens deny/revoke/reapprove confirm sheet
 *   executeConfirm()      — executes the confirmed action via rpc_admin_review_score
 *   handlePhotoPress()    — fetches signed URL for proof photo
 *   loadStats()           — loads StatsData for the Stats tab
 *   loadHealth()          — loads HealthData for the Health tab
 *
 * RPC calls used:
 *   rpc_admin_get_score_review_queue
 *   rpc_admin_review_score
 *   rpc_admin_create_score_proof_signed_url
 */

export { type ReviewTab, type ReviewScore, type ConfirmAction, type StatsData, type HealthData } from "./types";
