// client/manifest.ts — Server-Sent Events reader for /api/manifest responses. The
// server emits named SSE events; this bridges EventSource's push model to an
// async iterable of ScanStreamEvents. The events carry a server-computed
// `label` so the UI can name the project before any manifest arrives.

import type { Manifest } from '@/types/manifest';
import type { components } from '@/types/manifest.generated';
import { URL_PARAMS } from './urlParams';

import type { ApiUrl } from './url';

// ── SSE streaming reader ─────────────────────────────────────────────────

// The phases the stream advances through; values are the wire form. Distinct
// from LoadingStep, which is the user-facing row vocabulary.
export enum ScanPhase {
  CloneProgress = 'clone-progress',
  ScanProgress = 'scan-progress',
  PartialManifest = 'manifest-partial',
  CompleteManifest = 'manifest-complete',
  Error = 'error',
}

// git's own progress labels: Receiving/Resolving/Counting are fetch phases,
// Updating is the working-tree checkout.
export enum CloneStage {
  Receiving = 'receiving',
  Resolving = 'resolving',
  Counting = 'counting',
  Updating = 'updating',
}

// One variant per discriminant value so TS narrows cleanly through
// `if (event.phase === ScanPhase.CloneProgress || event.phase === ScanPhase.ScanProgress)` etc.
export type ScanStreamEvent =
  | {
      phase: ScanPhase.CloneProgress;
      label?: string;
      stage?: CloneStage;
      percent?: number;
      // Git's own counts. It holds a percent for minutes on a big fetch while
      // these climb, so they are what shows the transfer is alive.
      objects?: number;
      objects_total?: number;
      mib?: number;
      // Heartbeat during the silent promisor blob fetch: working-tree size on
      // disk (no stage/percent), so the UI shows materialization, not a freeze.
      mb_on_disk?: number;
    }
  | { phase: ScanPhase.ScanProgress; label?: string; files_scanned?: number }
  | { phase: ScanPhase.PartialManifest; manifest: Manifest }
  | { phase: ScanPhase.CompleteManifest; manifest: Manifest }
  | { phase: ScanPhase.Error; error: string; code?: ScanErrorCode };

/** Machine-readable reason on a terminal error. Keyed on, never on the message
 *  text: the wording is the server's to change. */
export type ScanErrorCode = components['schemas']['ErrorCode'];

/** A stream failure carrying the server's code through the throw: a plain
 *  Error would flatten it back to a string. */
export class ScanError extends Error {
  readonly code?: ScanErrorCode;
  constructor(message: string, code?: ScanErrorCode) {
    super(message);
    this.name = 'ScanError';
    this.code = code;
  }
}

/** The non-terminal progress events that carry loading-step detail (clone
 *  percent, files scanned). The shared progress helper consumes these. */
export type ScanProgressEvent = Extract<
  ScanStreamEvent,
  { phase: ScanPhase.CloneProgress | ScanPhase.ScanProgress }
>;

/** The lightweight poll the app uses to notice a repo changed under it. */
export interface SignatureResponse {
  root: string;
  scanned_at: string;
  content_signature: string;
}

export function createManifestEndpoints(apiUrl: ApiUrl) {
  // ── Endpoint URL builders ────────────────────────────────────────────────

  // Both take an EXPLICIT (src, branch), never the page URL: it lags a switch,
  // so the poll would fetch the wrong source mid-load.

  /** URL for the manifest stream of an explicit source. */
  function manifestUrlFor(opts: {
    src: string;
    branch?: string;
    noCache?: boolean;
    exclude?: string[];
    /** Reconstruct the repo as of this commit instead of scanning the working tree. */
    ref?: string;
  }): string {
    return apiUrl('manifest', {
      [URL_PARAMS.SRC]: opts.src,
      [URL_PARAMS.BRANCH]: opts.branch,
      [URL_PARAMS.NO_CACHE]: opts.noCache ? 'true' : undefined,
      [URL_PARAMS.EXCLUDE]: opts.exclude,
      ref: opts.ref,
    });
  }

  /** The newest manifest the server already has, or null. Never scans, and may be
   *  stale, which the one caller (the landing backdrop) does not mind. */
  async function fetchCachedManifest(
    src: string,
    branch: string | undefined,
    signal?: AbortSignal
  ): Promise<Manifest | null> {
    const url = apiUrl('manifest/cached', {
      [URL_PARAMS.SRC]: src,
      [URL_PARAMS.BRANCH]: branch,
    });
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) return null;
      return (await res.json()) as Manifest;
    } catch (_) {
      return null;
    }
  }

  /** URL for the lightweight signature poll of an explicit source. */
  function signatureUrlFor(src: string, branch?: string, exclude?: string[]): string {
    return apiUrl('manifest/signature', {
      [URL_PARAMS.SRC]: src,
      [URL_PARAMS.BRANCH]: branch,
      [URL_PARAMS.EXCLUDE]: exclude,
    });
  }

  /** Stream the manifest scan as an async iterable of {@link ScanStreamEvent}.
   *  EventSource auto-reconnects, so the stream is closed on final/error. */
  function streamManifest(
    url: string,
    opts: { signal?: AbortSignal; EventSourceImpl?: typeof EventSource } = {}
  ): AsyncIterable<ScanStreamEvent> {
    const EventSourceImpl = opts.EventSourceImpl ?? EventSource;
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

        // Closed cleanly (done, not error) so the consumer's for-await exits
        // without a manifest: loadSource reads signal.aborted as a user cancel.
        if (opts.signal) {
          if (opts.signal.aborted) finish();
          else opts.signal.addEventListener('abort', () => finish(), { once: true });
        }

        // Ends the stream on bad JSON rather than throwing into the listener,
        // where the throw is swallowed and the iterator hangs forever.
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

        // The server's terminal error and a transport drop share the 'error'
        // name; only the server's carries a JSON `data` string.
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

  /** The current content signature, or null if the poll did not land. A miss is
   *  not an error here: the caller simply keeps the manifest it already has. */
  async function fetchSignature(
    src: string,
    branch?: string,
    exclude?: string[]
  ): Promise<SignatureResponse | null> {
    const resp = await fetch(signatureUrlFor(src, branch, exclude));
    if (!resp.ok) return null;
    return (await resp.json()) as SignatureResponse | null;
  }

  return {
    manifestUrlFor,
    fetchCachedManifest,
    signatureUrlFor,
    streamManifest,
    fetchSignature,
  };
}
