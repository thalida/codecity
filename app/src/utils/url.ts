// url.ts — Build API URLs from the page's query params + current store
// state. Pure function so it's directly unit-testable; main.ts wraps it
// with the live `window.location.*` values for runtime callers.

import { SCAN_FILTERS } from '@/config/prefs/scanFilters.js';

/**
 * Build the URL for a server endpoint, forwarding the page's `src` (and
 * optional `branch`) params plus SCAN_FILTERS toggles (`no_cache`). When
 * no `src` is present, returns the endpoint URL without any source params —
 * boot uses this to detect "no source picked yet".
 */
export function buildApiUrl(endpoint: string, pageSearch: string, origin: string): string {
  const qp = new URLSearchParams(pageSearch);
  const u = new URL(endpoint, origin);
  if (qp.has('src')) {
    u.searchParams.set('src', qp.get('src')!);
    if (qp.has('branch')) u.searchParams.set('branch', qp.get('branch')!);
    // git_window only travels through with a source; without ?src= the
    // endpoint is a no-op anyway, so don't bother forwarding it.
    if (qp.has('git_window')) u.searchParams.set('git_window', qp.get('git_window')!);
  }
  const filters = SCAN_FILTERS.get();
  if (filters.NO_CACHE) {
    u.searchParams.set('no_cache', 'true');
  }
  return u.toString();
}

// Runtime wrappers that bind `buildApiUrl` to the live `window.location.*`
// values. Kept here (rather than at callsites) so the boot orchestrator and
// the live-update poll loop share the same construction path. Pure helper
// stays separately testable via buildApiUrl.

export function manifestUrl(): string {
  return buildApiUrl('/api/manifest', window.location.search, window.location.origin);
}

export function signatureUrl(): string {
  return buildApiUrl('/api/manifest/signature', window.location.search, window.location.origin);
}
