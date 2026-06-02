// api/manifest.ts — NDJSON streaming reader for /api/manifest responses. Each line is a
// single JSON event. The browser handles Content-Encoding: gzip
// transparently, so we read decoded UTF-8 text directly.
//
// Event variants (server emits in roughly this order):
//   cloning  — first event for git sources, sent BEFORE the clone
//              subprocess runs. Carries `display_root` so the UI can
//              show a "{label} (pending)" header / document title from
//              the moment the request starts, not from when the manifest
//              finally arrives. The UI also uses it to light up its
//              "Cloning" step from real state instead of a wall-clock
//              timer.
//   scanning — first event for local sources (and the second event for
//              git sources). Same `display_root` payload, same UI role.
//   skeleton — first paint manifest with placeholder building heights.
//   final    — populated manifest ready for the final tween.
//   error    — fatal mid-stream failure; client should surface and stop.

import type { Manifest } from '@/types/manifest';
import { URL_PARAMS } from '@/constants/urlParams';
// ── URL helper ───────────────────────────────────────────────────────────

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
 * Pure function (no `window` access) so the endpoint wrappers below can
 * bind it to live `window.location.*` values while this helper stays
 * directly unit-testable.
 */
export function buildApiUrl(
  endpoint: string,
  pageSearch: string,
  origin: string,
  opts: BuildApiUrlOpts = {}
): string {
  const qp = new URLSearchParams(pageSearch);
  const u = new URL(endpoint, origin);
  if (qp.has(URL_PARAMS.SRC)) {
    u.searchParams.set(URL_PARAMS.SRC, qp.get(URL_PARAMS.SRC)!);
    if (qp.has(URL_PARAMS.BRANCH)) u.searchParams.set(URL_PARAMS.BRANCH, qp.get(URL_PARAMS.BRANCH)!);
  }
  if (opts.noCache) {
    u.searchParams.set(URL_PARAMS.NO_CACHE, 'true');
  }
  return u.toString();
}

// ── Endpoint URL builders ────────────────────────────────────────────────

/** URL for the manifest stream endpoint, bound to the current page's
 *  `?src` (and optional `?branch`) query params. */
export function manifestUrl(opts: BuildApiUrlOpts = {}): string {
  return buildApiUrl('/api/manifest', window.location.search, window.location.origin, opts);
}

/** URL for the lightweight manifest-signature poll endpoint. */
export function signatureUrl(): string {
  return buildApiUrl('/api/manifest/signature', window.location.search, window.location.origin);
}

/** URL for the manifest stream of an EXPLICIT source — used when loading or
 *  switching to a source whose params aren't on the page URL yet (the picker
 *  submit path). `manifestUrl()` reads the page URL; this takes the source
 *  directly. */
export function manifestUrlFor(opts: { src: string; branch?: string; noCache?: boolean }): string {
  // Delegate param assembly to buildApiUrl (single source of truth for the
  // src/branch/no_cache query contract); just feed it an explicit search
  // string instead of the page's location.search.
  const search = new URLSearchParams({ [URL_PARAMS.SRC]: opts.src });
  if (opts.branch) search.set(URL_PARAMS.BRANCH, opts.branch);
  return buildApiUrl('/api/manifest', search.toString(), window.location.origin, {
    noCache: opts.noCache,
  });
}

// ── NDJSON streaming reader ──────────────────────────────────────────────

// The phases the NDJSON scan stream advances through. String values are the
// wire form the server emits. (Distinct from constants/loadingSteps' LoadingStep,
// which is the UI step vocabulary — there's no 'building' phase: the Final event
// drives the "Building city" step.)
export enum ScanPhase {
  Cloning = 'cloning',
  Scanning = 'scanning',
  Skeleton = 'skeleton',
  Final = 'final',
  Error = 'error',
}

// One variant per discriminant value so TS narrows cleanly through
// `if (event.phase === ScanPhase.Cloning || event.phase === ScanPhase.Scanning)` etc.
export type ScanStreamEvent =
  | {
      phase: ScanPhase.Cloning;
      display_root?: string;
      stage?: 'receiving' | 'resolving' | 'counting';
      percent?: number;
    }
  | { phase: ScanPhase.Scanning; display_root?: string; files_scanned?: number }
  | { phase: ScanPhase.Skeleton; manifest: Manifest }
  | { phase: ScanPhase.Final; manifest: Manifest }
  | { phase: ScanPhase.Error; error: string };

/** The non-terminal progress events that carry loading-step detail (clone
 *  percent, files scanned). The shared progress helper consumes these. */
export type ScanProgressEvent = Extract<
  ScanStreamEvent,
  { phase: ScanPhase.Cloning | ScanPhase.Scanning }
>;

export async function* streamManifest(
  url: string,
  fetchImpl: typeof fetch = fetch
): AsyncIterable<ScanStreamEvent> {
  const resp = await fetchImpl(url);
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    const errMsg = body && typeof body.error === 'string' ? body.error : `HTTP ${resp.status}`;
    throw new Error(errMsg);
  }
  if (!resp.body) {
    throw new Error('Response has no body');
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  // Buffer grows up to one full NDJSON line — for the final-manifest
  // event that can be 10MB-300MB of UTF-8. Acceptable here because
  // the server emits at most 2 events per response.
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) yield JSON.parse(line) as ScanStreamEvent;
    }
  }
  if (buf.trim()) yield JSON.parse(buf) as ScanStreamEvent;
}

/**
 * Clear the server-side scan cache for one (src, branch) pair. Best-effort —
 * failures are swallowed (cache-clear is a UX nicety, not a correctness path).
 */
export function clearManifestCache(src: string, branch?: string): void {
  const url = new URL('/api/manifest/cache', window.location.origin);
  url.searchParams.set(URL_PARAMS.SRC, src);
  if (branch) url.searchParams.set(URL_PARAMS.BRANCH, branch);
  fetch(url.toString(), { method: 'DELETE' }).catch(() => {});
}

