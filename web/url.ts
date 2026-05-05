// url.ts — Build API URLs from the page's query params + current store
// state. Pure function so it's directly unit-testable; main.ts wraps it
// with the live `window.location.*` values for runtime callers.

import { SCAN_FILTERS } from './config/scan.js';

/**
 * Build the URL for a server endpoint, forwarding the page's path/clone/branch
 * params (set by the CLI on initial open) and appending include_all when the
 * SHOW_ALL_FILES toggle is on. Other query params on the page are intentionally
 * dropped — only the ones the server cares about are forwarded.
 */
export function buildApiUrl(
  endpoint: string,
  pageSearch: string,
  origin: string
): string {
  const qp = new URLSearchParams(pageSearch);
  const u = new URL(endpoint, origin);
  if (qp.has('clone')) {
    u.searchParams.set('clone', qp.get('clone'));
    if (qp.has('branch')) u.searchParams.set('branch', qp.get('branch'));
  } else if (qp.has('path')) {
    u.searchParams.set('path', qp.get('path'));
  }
  if (SCAN_FILTERS.get().SHOW_ALL_FILES) {
    u.searchParams.set('include_all', 'true');
  }
  return u.toString();
}
