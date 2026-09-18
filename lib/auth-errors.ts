/** Transport errors and server outages must not erase a valid local session. */
export function isInvalidSession(error: { status?: number; code?: string } | null): boolean {
  return !!error && (error.status === 401 || ["session_not_found", "refresh_token_not_found",
    "refresh_token_already_used", "user_not_found", "bad_jwt"].includes(error.code ?? ""));
}
