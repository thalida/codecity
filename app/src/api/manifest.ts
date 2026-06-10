// api/manifest.ts — Server-Sent Events reader for /api/manifest responses. The
// server emits named SSE events (`event: <name>\ndata: <json>\n\n`); we bridge
// EventSource's push model to an async iterable of ScanStreamEvents.
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
    if (qp.has(URL_PARAMS.BRANCH))
      u.searchParams.set(URL_PARAMS.BRANCH, qp.get(URL_PARAMS.BRANCH)!);
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

// ── SSE streaming reader ─────────────────────────────────────────────────

// The phases the SSE scan stream advances through. String values are the wire
// form the server emits (the SSE event name) and describe what each event
// delivers — progress vs a manifest at a completeness level — not its position
// in the sequence. (Distinct from constants/loadingSteps' LoadingStep, which is
// the user-facing UI step vocabulary.)
export enum ScanPhase {
  CloneProgress = 'clone-progress',
  ScanProgress = 'scan-progress',
  PartialManifest = 'manifest-partial',
  CompleteManifest = 'manifest-complete',
  Error = 'error',
}

// One variant per discriminant value so TS narrows cleanly through
// `if (event.phase === ScanPhase.CloneProgress || event.phase === ScanPhase.ScanProgress)` etc.
export type ScanStreamEvent =
  | {
      phase: ScanPhase.CloneProgress;
      display_root?: string;
      stage?: 'receiving' | 'resolving' | 'counting';
      percent?: number;
    }
  | { phase: ScanPhase.ScanProgress; display_root?: string; files_scanned?: number }
  | { phase: ScanPhase.PartialManifest; manifest: Manifest }
  | { phase: ScanPhase.CompleteManifest; manifest: Manifest }
  | { phase: ScanPhase.Error; error: string };

/** The non-terminal progress events that carry loading-step detail (clone
 *  percent, files scanned). The shared progress helper consumes these. */
export type ScanProgressEvent = Extract<
  ScanStreamEvent,
  { phase: ScanPhase.CloneProgress | ScanPhase.ScanProgress }
>;

/**
 * Stream the manifest scan as Server-Sent Events, surfaced as an async
 * iterable of {@link ScanStreamEvent} (same contract the NDJSON reader had,
 * so `pumpManifestStream`/`loadSource`/`setupLiveUpdates` are untouched).
 *
 * EventSource auto-reconnects, so we `es.close()` on `final`/`error` to avoid
 * a reconnect storm once the stream legitimately ends. Server-describable
 * failures arrive as a named `error` event (the server never relies on a 4xx
 * body — EventSource can't read those); a transport drop rejects the stream.
 *
 * The EventSource constructor is injectable for testing (defaults to the
 * browser global).
 */
export function streamManifest(
  url: string,
  EventSourceImpl: typeof EventSource = EventSource
): AsyncIterable<ScanStreamEvent> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<ScanStreamEvent> {
      const es = new EventSourceImpl(url);
      const queue: ScanStreamEvent[] = [];
      let resolveNext: ((r: IteratorResult<ScanStreamEvent>) => void) | null = null;
      let rejectNext: ((reason: unknown) => void) | null = null;
      let failure: Error | null = null;
      let done = false;

      const push = (ev: ScanStreamEvent): void => {
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = rejectNext = null;
          r({ value: ev, done: false });
        } else {
          queue.push(ev);
        }
        if (ev.phase === ScanPhase.CompleteManifest || ev.phase === ScanPhase.Error) finish();
      };

      const finish = (err?: Error): void => {
        if (done) return;
        done = true;
        es.close();
        if (err) {
          failure = err;
          if (rejectNext) {
            const rej = rejectNext;
            resolveNext = rejectNext = null;
            rej(err);
          }
        } else if (resolveNext) {
          const r = resolveNext;
          resolveNext = rejectNext = null;
          r({ value: undefined, done: true });
        }
      };

      // Parse an event's JSON data, ending the stream with an error (rather
      // than throwing into the swallowed event listener, which would leave the
      // iterator hanging forever) if the payload is malformed/truncated.
      const parseData = (raw: string): Record<string, unknown> | null => {
        try {
          return JSON.parse(raw) as Record<string, unknown>;
        } catch {
          finish(new Error('malformed manifest event'));
          return null;
        }
      };

      const on = (name: string, phase: ScanPhase): void => {
        es.addEventListener(name, (e) => {
          const parsed = parseData((e as MessageEvent).data);
          if (parsed) push({ phase, ...parsed } as ScanStreamEvent);
        });
      };
      on('clone-progress', ScanPhase.CloneProgress);
      on('scan-progress', ScanPhase.ScanProgress);
      on('manifest-partial', ScanPhase.PartialManifest);
      on('manifest-complete', ScanPhase.CompleteManifest);

      // The server's terminal `error` event and EventSource's transport-error
      // event share the 'error' name. A server event carries a JSON `data`
      // string; a transport drop is a bare Event with no data.
      es.addEventListener('error', (e) => {
        const data = (e as MessageEvent).data;
        if (typeof data === 'string') {
          const parsed = parseData(data);
          if (parsed) push({ phase: ScanPhase.Error, ...parsed } as ScanStreamEvent);
        } else if (!done) {
          finish(new Error('manifest stream connection failed'));
        }
      });

      return {
        next(): Promise<IteratorResult<ScanStreamEvent>> {
          if (queue.length) return Promise.resolve({ value: queue.shift()!, done: false });
          if (failure) return Promise.reject(failure);
          if (done) return Promise.resolve({ value: undefined, done: true });
          return new Promise((res, rej) => {
            resolveNext = res;
            rejectNext = rej;
          });
        },
        return(): Promise<IteratorResult<ScanStreamEvent>> {
          finish();
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
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
