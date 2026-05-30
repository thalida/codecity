// api/index.ts — Shared API helpers. Endpoint-specific code (URL builders,
// fetchers, streaming) lives in sibling files (api/manifest.ts,
// api/commit.ts, api/config.ts).

export interface BuildApiUrlOpts {
  noCache?: boolean;
}

/**
 * Build the URL for a server endpoint, forwarding the page's `src`
 * (and optional `branch`) params. When `opts.noCache` is true,
 * appends `no_cache=true` to force a fresh scan on this request.
 * When no `src` is present, returns the endpoint URL without any
 * source params — boot uses this to detect "no source picked yet".
 *
 * Pure function (no `window` access) so endpoint-specific wrappers
 * in sibling modules can bind it to live `window.location.*` values
 * while this helper stays directly unit-testable.
 */
export function buildApiUrl(
  endpoint: string,
  pageSearch: string,
  origin: string,
  opts: BuildApiUrlOpts = {}
): string {
  const qp = new URLSearchParams(pageSearch);
  const u = new URL(endpoint, origin);
  if (qp.has('src')) {
    u.searchParams.set('src', qp.get('src')!);
    if (qp.has('branch')) u.searchParams.set('branch', qp.get('branch')!);
  }
  if (opts.noCache) {
    u.searchParams.set('no_cache', 'true');
  }
  return u.toString();
}
