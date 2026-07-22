// api/timeline.ts — Server-Sent Events reader for /api/timeline: the history
// walk + blob resolution can take a while on a big repo, so the server streams
// `timeline-progress` heartbeats before the terminal `timeline-complete` bundle.
// Mirrors api/manifest.ts's streamManifest, but as a promise (the caller wants
// one bundle, not an async iterable) with progress delivered via callback.

import { apiUrl } from '@/api/apiUrl';
import { URL_PARAMS } from '@/constants/urlParams';
import type { TimelineBundle, TimelineProgress } from '@/types';

/** URL for the timeline bundle stream of an explicit source. */
export function timelineUrlFor(src: string, branch?: string): string {
  return apiUrl('timeline', { [URL_PARAMS.SRC]: src, [URL_PARAMS.BRANCH]: branch });
}

/**
 * Fetch the timeline bundle over SSE. Resolves with the bundle on
 * `timeline-complete`; rejects on a server `error` event or transport
 * failure. `onProgress` fires for each `timeline-progress` heartbeat (a warm
 * cache hit skips straight to `timeline-complete`, no progress events).
 *
 * The EventSource constructor is injectable for testing (defaults to the
 * browser global), matching streamManifest.
 */
export function fetchTimelineBundle(
  src: string,
  branch?: string,
  onProgress?: (p: TimelineProgress) => void,
  opts: { EventSourceImpl?: typeof EventSource } = {}
): Promise<TimelineBundle> {
  const EventSourceImpl = opts.EventSourceImpl ?? EventSource;
  return new Promise((resolve, reject) => {
    const es = new EventSourceImpl(timelineUrlFor(src, branch));
    let done = false;

    const finish = (fn: () => void): void => {
      if (done) return;
      done = true;
      es.close();
      fn();
    };

    // Parse an event's JSON data, ending the stream with a rejection (rather
    // than throwing into the swallowed event listener, which would leave the
    // promise hanging forever) if the payload is malformed/truncated.
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

    // The server's terminal `error` event and EventSource's transport-error
    // event share the 'error' name. A server event carries a JSON `data`
    // string; a transport drop is a bare Event with no data.
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
