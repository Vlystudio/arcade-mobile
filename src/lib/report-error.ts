import * as Sentry from "@sentry/react-native";

/**
 * Reports an operational error (failed network/RPC call, unexpected
 * exception) to Sentry so it can trigger Slack alerts. Do not use this
 * for client-side input validation messages (e.g. "passwords don't
 * match") - those are expected user feedback, not bugs.
 */
export function reportError(scope: string, message: string, extra?: Record<string, unknown>) {
  Sentry.captureMessage(message, {
    level: "error",
    tags: { scope },
    extra,
  });
}
