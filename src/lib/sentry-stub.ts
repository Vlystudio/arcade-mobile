// Web stub for @sentry/react-native — all no-ops so the web bundle compiles.
// Metro resolves this file instead of the native SDK when platform === "web".
const noop = () => {};
const noopObj = () => ({});

export const init = noop;
export const wrap = (c: unknown) => c;
export const captureException = noop;
export const captureMessage = noop;
export const captureEvent = noop;
export const addBreadcrumb = noop;
export const setUser = noop;
export const setTag = noop;
export const setExtra = noop;
export const setContext = noop;
export const withScope = noop;
export const configureScope = noop;
export const startTransaction = noopObj;
export const mobileReplayIntegration = noopObj;
export const feedbackIntegration = noopObj;
export const reactNavigationIntegration = noopObj;
export const ReactNativeTracing = noopObj;
export const TouchEventBoundary = ({ children }: { children: unknown }) => children;

export default {
  init, wrap, captureException, captureMessage, captureEvent, addBreadcrumb,
  setUser, setTag, setExtra, setContext, withScope, configureScope,
  startTransaction, mobileReplayIntegration, feedbackIntegration,
  reactNavigationIntegration, ReactNativeTracing, TouchEventBoundary,
};
