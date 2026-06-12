// Tiny module-level event bus that marks "the user just hit an error".
// reportError() and BugReportBanner feed it; the screenshot button listens
// so it only appears when a screenshot would actually be useful.

let lastErrorAt = 0;
const listeners = new Set<() => void>();

export function signalError() {
  lastErrorAt = Date.now();
  listeners.forEach((fn) => fn());
}

export function getLastErrorAt() {
  return lastErrorAt;
}

export function onErrorSignal(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
