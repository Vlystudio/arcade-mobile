// Security: admin check is UX-only. All mutations use SECURITY DEFINER RPCs that enforce MFA + is_admin() server-side.

/**
 * ForumModerationPanel
 *
 * Hosts the forum moderation queue (pending/approved tabs), auto-flag badge display,
 * approve/reject actions.
 *
 * All Supabase calls for this feature live in src/app/admin.tsx.
 *
 * Relevant functions in admin.tsx:
 *   loadPendingForums()  — fetches forums by status from the forums table
 *   handleForumAction()  — approves or rejects via rpc_admin_update_forum_status
 *
 * Local types (defined inline in admin.tsx):
 *   PendingForum — { id, title, description, game_type, creator_username, created_at, auto_flagged, flag_category }
 */
