// Security: admin check is UX-only. All mutations use SECURITY DEFINER RPCs that enforce MFA + is_admin() server-side.

/**
 * useAdminCheck / checkAdminAndLoad
 *
 * The admin gate logic lives in src/app/admin.tsx as `checkAdminAndLoad()`.
 * It reads the `role` field from the `profiles` table and redirects
 * non-admin users to the root screen.
 *
 * Accepted roles: "admin", "owner", "architect"
 *
 * This file documents the pattern for reference and future extraction:
 *
 * ```ts
 * async function checkAdminAndLoad() {
 *   const { data } = await supabase
 *     .from("profiles")
 *     .select("role")
 *     .eq("id", user!.id)
 *     .single();
 *   const role = data?.role ?? "user";
 *   if (!["admin", "owner", "architect"].includes(role)) {
 *     router.replace("/");
 *     return;
 *   }
 *   setIsAdmin(true);
 *   setUserRole(role);
 *   setChecking(false);
 * }
 * ```
 *
 * Note: This is a UX-only gate. All backend RPCs independently verify
 * `is_admin()` / `is_venue_admin()` and MFA status server-side.
 */
