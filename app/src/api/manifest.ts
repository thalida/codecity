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
import { buildApiUrl, type BuildApiUrlOpts } from './';

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
  const u = new URL('/api/manifest', window.location.origin);
  u.searchParams.set('src', opts.src);
  if (opts.branch) u.searchParams.set('branch', opts.branch);
  if (opts.noCache) u.searchParams.set('no_cache', 'true');
  return u.toString();
}

// ── NDJSON streaming reader ──────────────────────────────────────────────

// One variant per discriminant value so TS narrows cleanly through
// `if (event.phase === 'cloning' || event.phase === 'scanning')` etc.
export type ScanStreamEvent =
  | {
      phase: 'cloning';
      display_root?: string;
      stage?: 'receiving' | 'resolving' | 'counting';
      percent?: number;
    }
  | { phase: 'scanning'; display_root?: string; files_scanned?: number }
  | { phase: 'skeleton'; manifest: Manifest }
  | { phase: 'final'; manifest: Manifest }
  | { phase: 'error'; error: string };

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
  url.searchParams.set('src', src);
  if (branch) url.searchParams.set('branch', branch);
  fetch(url.toString(), { method: 'DELETE' }).catch(() => {});
}

