// Security: admin check is UX-only. All mutations use SECURITY DEFINER RPCs that enforce MFA + is_admin() server-side.

/**
 * VenueAdminPanel
 *
 * Currently used as a wrapper container for the Teams and Scheduler tabs in admin.tsx.
 * In a future iteration this panel will host venue-specific management:
 * lane QR token generation/revocation, venue admin role management, and
 * venue health metrics.
 *
 * Relevant RPCs for future implementation:
 *   rpc_admin_generate_lane_qr_token — generates a hashed+expiring lane QR token
 *   venue_admins table               — venue-level role assignments (admin/owner/staff)
 */
