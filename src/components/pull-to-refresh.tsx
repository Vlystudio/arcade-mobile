// Native: no-op. Native screens use React Native's own RefreshControl.
// The real implementation lives in pull-to-refresh.web.tsx (Metro picks
// the .web variant for web/PWA builds).
export function PullToRefresh() {
  return null;
}
