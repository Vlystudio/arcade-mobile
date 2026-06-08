// Security: admin check is UX-only. All mutations use SECURITY DEFINER RPCs that enforce MFA + is_admin() server-side.

/**
 * UserRoleAdminPanel
 *
 * Hosts the user search input, user list with role pills, and role-change buttons.
 * Only visible to owner and architect roles.
 *
 * All Supabase calls for this feature live in src/app/admin.tsx.
 *
 * Relevant functions in admin.tsx:
 *   loadUsers()        — fetches all users via rpc_admin_get_users
 *   handleRoleChange() — changes a user's role via set_user_role RPC
 *
 * Local types (defined inline in admin.tsx):
 *   UserProfile — { id, username, avatar_url, role, email? }
 */
