// utils/debugMode.ts — Gate for developer-only UI (the header bug icon and
// its DebugModal). On in a dev server, when built with VITE_DEBUG, or with
// ?debug in the URL — so a prod deploy can still be flipped on for support.

export function isDebugMode(): boolean {
  if (import.meta.env.DEV) return true;
  if (import.meta.env.VITE_DEBUG) return true;
  return new URLSearchParams(window.location.search).has('debug');
}
