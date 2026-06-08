// Security: admin check is UX-only. All mutations use SECURITY DEFINER RPCs that enforce MFA + is_admin() server-side.

/**
 * TournamentAdminPanel
 *
 * Hosts the tournament requests (pending/approved/denied) and manage tabs,
 * bracket management, QR code generation/revocation, guest player management,
 * player roster viewer, and tournament edit/delete modals.
 *
 * All Supabase calls for this feature live in src/app/admin.tsx.
 * This module exports the types used by that screen.
 *
 * Relevant functions in admin.tsx:
 *   loadTournRequests()       — fetches tournament requests by status
 *   handleApproveTournament() — approves a request via rpc_admin_approve_tournament
 *   handleDenyTournament()    — denies a request via rpc_admin_deny_tournament
 *   loadManageTournaments()   — fetches all tournaments with reg counts + bracket status
 *   handleMarkStatus()        — changes tournament status via rpc_admin_set_tournament_status
 *   handleCreateFirstFriday() — creates First Friday event via rpc_admin_create_first_friday
 *   handleGenerateQR()        — generates QR code via rpc_admin_generate_ff_signup_qr
 *   handleRevokeQR()          — revokes QR code via rpc_admin_revoke_ff_signup_qr
 *   handleEditTournament()    — edits tournament via rpc_admin_update_tournament
 *   handleDeleteTournament()  — deletes tournament via rpc_admin_delete_tournament
 *   loadBracket()             — fetches bracket data via rpc_ff_get_bracket
 *   handleGenerateBracket()   — generates bracket via rpc_ff_generate_bracket
 *   handleSubmitGameScores()  — submits scores via rpc_ff_submit_game_scores
 *   openGuestManager()        — opens guest player modal via rpc_ff_get_guest_players
 *   handleAddGuest()          — adds guest player via rpc_admin_add_ff_guest
 *   handleRemoveGuest()       — removes guest player via rpc_admin_remove_ff_guest
 *   openPlayerManager()       — opens player roster from tournament_registrations
 *   handleRemovePlayer()      — removes player via rpc_admin_remove_tournament_player
 *   handleSaveResults()       — saves tournament placements via rpc_admin_save_placements
 */

export {
  type TournamentRequest,
  type ManageTournament,
  type BracketSlot,
  type BracketScore,
  type BracketGame,
  type BracketGroup,
  type BracketRound,
} from "./types";
