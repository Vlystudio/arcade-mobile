type BrowserSdk = typeof import("@sentry/browser");
let ready: Promise<BrowserSdk | undefined> | undefined;

// Keep monitoring in a separate web chunk; retain startup errors while it loads.
export function init(options: { dsn?: string; sendDefaultPii?: boolean }) {
  if (typeof window === "undefined" || ready) return ready;
  const startupErrors: unknown[] = [];
  const remember = (error: unknown) => { if (startupErrors.length < 20) startupErrors.push(error); };
  const onError = (event: ErrorEvent) => remember(event.error ?? new Error(event.message));
  const onRejection = (event: PromiseRejectionEvent) => remember(event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  const detach = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
  ready = import("@sentry/browser").then(sdk => {
    sdk.init({
      dsn: options.dsn,
      sendDefaultPii: false,
      beforeSend(event) {
        // Request bodies, credentials and user-provided extras do not belong in telemetry.
        event.extra = undefined;
        if (event.user) event.user = { id: event.user.id };
        if (event.request) {
          event.request.data = undefined;
          event.request.headers = undefined;
          event.request.cookies = undefined;
          if (event.request.url) event.request.url = event.request.url.split(/[?#]/)[0];
        }
        return event;
      },
    });
    detach();
    startupErrors.forEach(error => sdk.captureException(error));
    return sdk;
  }).catch(error => {
    detach();
    console.warn("Web error reporting could not load", error);
    return undefined;
  });
  return ready;
}
export function captureMessage(...args: Parameters<BrowserSdk["captureMessage"]>) {
  return ready?.then(sdk => sdk?.captureMessage(...args));
}
export function captureException(...args: Parameters<BrowserSdk["captureException"]>) {
  return ready?.then(sdk => sdk?.captureException(...args));
}
export const wrap = <T,>(component: T): T => component;
export const mobileReplayIntegration = () => undefined;
export const feedbackIntegration = () => undefined;
