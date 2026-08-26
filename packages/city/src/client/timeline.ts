// client/timeline.ts — SSE reader for /api/timeline. Mirrors streamManifest, but
// as a promise with progress by callback: the caller wants one bundle, and the
// history walk is slow enough to need heartbeats before it.

import { URL_PARAMS } from './urlParams';
import type { TimelineBundle, TimelineProgress } from '@/types';

import type { ApiUrl } from './url';

export function createTimelineEndpoints(apiUrl: ApiUrl) {
  /** URL for the timeline bundle stream. The bundle is cached per HEAD, so a
   *  fresh scan has to pass `noCache` to get the walk done again. */
  function timelineUrlFor(
    src: string,
    branch?: string,
    exclude?: string[],
    noCache?: boolean
  ): string {
    return apiUrl('timeline', {
      [URL_PARAMS.SRC]: src,
      [URL_PARAMS.BRANCH]: branch,
      [URL_PARAMS.EXCLUDE]: exclude,
      [URL_PARAMS.NO_CACHE]: noCache ? 'true' : undefined,
    });
  }

  /** Fetch the bundle over SSE, resolving on `timeline-complete`. A warm cache
   *  hit skips straight there, so `onProgress` may never fire. */
  function fetchTimelineBundle(
    src: string,
    branch?: string,
    onProgress?: (p: TimelineProgress) => void,
    opts: {
      EventSourceImpl?: typeof EventSource;
      signal?: AbortSignal;
      exclude?: string[];
      noCache?: boolean;
    } = {}
  ): Promise<TimelineBundle> {
    const EventSourceImpl = opts.EventSourceImpl ?? EventSource;
    return new Promise((resolve, reject) => {
      const es = new EventSourceImpl(timelineUrlFor(src, branch, opts.exclude, opts.noCache));
      let done = false;

      const finish = (fn: () => void): void => {
        if (done) return;
        done = true;
        es.close();
        opts.signal?.removeEventListener('abort', onAbort);
        fn();
      };

      // The caller (a user Cancel on the loading overlay) aborts the in-flight
      // history stream; close it and reject as an abort so the caller stays put.
      const onAbort = (): void =>
        finish(() => {
          const e = new Error('Timeline load aborted');
          e.name = 'AbortError';
          reject(e);
        });
      if (opts.signal?.aborted) {
        onAbort();
        return;
      }
      opts.signal?.addEventListener('abort', onAbort);

      // Rejects rather than throwing into the listener, where the throw is
      // swallowed and the promise hangs forever.
      const parseData = (raw: string): Record<string, unknown> | null => {
        try {
          return JSON.parse(raw) as Record<string, unknown>;
        } catch {
          finish(() => reject(new Error('malformed timeline event')));
          return null;
        }
      };

      es.addEventListener('timeline-progress', (e) => {
        const parsed = parseData((e as MessageEvent).data);
        if (parsed) onProgress?.(parsed as TimelineProgress);
      });

      es.addEventListener('timeline-complete', (e) => {
        const parsed = parseData((e as MessageEvent).data);
        if (parsed) finish(() => resolve((parsed as { bundle: TimelineBundle }).bundle));
      });

      // The server's terminal error and a transport drop share the 'error'
      // name; only the server's carries a JSON `data` string.
      es.addEventListener('error', (e) => {
        const data = (e as MessageEvent).data;
        if (typeof data === 'string') {
          const parsed = parseData(data);
          if (parsed) finish(() => reject(new Error((parsed as { error: string }).error)));
        } else if (!done) {
          finish(() => reject(new Error('timeline stream connection failed')));
        }
      });
    });
  }

  return {
    timelineUrlFor,
    fetchTimelineBundle,
  };
}
