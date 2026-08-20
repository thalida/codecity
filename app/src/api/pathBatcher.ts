// Coalesces per-path requests into batched POSTs (one GET per building exhausts
// the HTTP/1.1 pool). Callers supply only endpoint, body shape, and decode.

import { serverConfigNow } from '@/api/config';

/** What a batch answers when a path has no bytes YET, as opposed to null,
 *  which means omitted: try the single-file route. Nothing to retry here, so
 *  the caller keeps its placeholder. A value in the callers' `T`, not a shape
 *  this module knows: batching is the same regardless of what an entry means. */
export const PENDING = Symbol('content pending');
export type Pending = typeof PENDING;

/** One request's resolver. `null` means the server omitted that path. */
type Waiter<T> = (value: T | null) => void;

export interface PathBatcherOptions<T, E> {
  /** POST target, e.g. `/api/images`. */
  endpoint: string;
  /** Turn one response entry into the caller's value; return null to omit. */
  decode: (entry: E) => T | null;
  /** Extra fields merged into the POST body alongside `paths`. */
  bodyFor?: (paths: string[]) => Record<string, unknown>;
  /** Runs once per path after its batch settles, before waiters resolve. */
  onSettled?: (path: string) => void;
  /** Coalescing window. One frame gathers essentially a whole scene build. */
  flushMs?: number;
}

export interface PathBatcher<T> {
  request(path: string): Promise<T | null>;
}

export function createPathBatcher<T, E>(opts: PathBatcherOptions<T, E>): PathBatcher<T> {
  const { endpoint, decode, bodyFor, onSettled, flushMs = 16 } = opts;
  const queue = new Map<string, Waiter<T>[]>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function sendBatch(paths: string[], pending: Map<string, Waiter<T>[]>): Promise<void> {
    let result: Record<string, E> = {};
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paths, ...(bodyFor?.(paths) ?? {}) }),
      });
      if (res.ok) result = (await res.json()) as Record<string, E>;
    } catch {
      // Network failure: every path in this batch resolves null, and callers
      // fall back to whatever single-path route they have.
    }
    for (const path of paths) {
      const entry = result[path];
      const value = entry === undefined ? null : decode(entry);
      onSettled?.(path);
      for (const resolve of pending.get(path) ?? []) resolve(value);
    }
  }

  function flush(): void {
    timer = null;
    // Snapshot + clear so requests arriving during the awaits start a fresh batch.
    const pending = new Map(queue);
    queue.clear();
    const paths = [...pending.keys()];
    // The server truncates past its cap, so chunk to the number it published
    // rather than a local guess that could silently drop the tail.
    const batchSize = serverConfigNow().maxBatchPaths;
    for (let i = 0; i < paths.length; i += batchSize) {
      void sendBatch(paths.slice(i, i + batchSize), pending);
    }
  }

  return {
    request(path: string): Promise<T | null> {
      return new Promise((resolve) => {
        const waiters = queue.get(path);
        if (waiters) waiters.push(resolve);
        else queue.set(path, [resolve]);
        if (timer === null) timer = setTimeout(flush, flushMs);
      });
    },
  };
}
