// Security: admin check is UX-only. All mutations use SECURITY DEFINER RPCs that enforce MFA + is_admin() server-side.

/**
 * AuditSecurityLogsPanel
 *
 * Currently used as a wrapper container for the Stats and Health tabs in admin.tsx.
 * In a future iteration this panel will render the security event log viewer
 * and admin audit log viewer, fetched via rpc_admin_get_security_events.
 *
 * Relevant RPCs for future implementation:
 *   rpc_admin_get_security_events — paginated security event reader (admin-only)
 *   admin_audit_log               — direct table read via service role or admin RLS policy
 */
