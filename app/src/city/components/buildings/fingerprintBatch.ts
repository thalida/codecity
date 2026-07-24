// city/components/buildings/fingerprintBatch.ts — coalesces binary-file
// fingerprint fetches into POST /api/fingerprints batches (mirrors mediaBatch).
// The server returns a small base64 byte-pattern PNG per path; callers feed it to
// an <img> via a data URL. A path the endpoint omits resolves to null.

/** Max paths per request — mirrors the server-side cap. */
const BATCH_SIZE = 32;
/** Coalescing window: data buildings register in a burst at scene build. */
const FLUSH_MS = 16;

interface BatchEntry {
  b64: string;
}

type Waiter = (b64: string | null) => void;

const _queue = new Map<string, Waiter[]>();
let _timer: ReturnType<typeof setTimeout> | null = null;

/** Request a binary file's fingerprint PNG (base64) via the batch endpoint.
 *  Resolves with the base64 string, or null when the server omitted it. */
export function fetchFingerprintB64(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    const waiters = _queue.get(path);
    if (waiters) {
      waiters.push(resolve);
    } else {
      _queue.set(path, [resolve]);
    }
    if (_timer === null) _timer = setTimeout(_flush, FLUSH_MS);
  });
}

function _flush(): void {
  _timer = null;
  // Snapshot + clear so requests arriving during the awaits start a fresh batch.
  const pending = new Map(_queue);
  _queue.clear();
  const paths = [...pending.keys()];
  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    void _sendBatch(paths.slice(i, i + BATCH_SIZE), pending);
  }
}

async function _sendBatch(paths: string[], pending: Map<string, Waiter[]>): Promise<void> {
  let result: Record<string, BatchEntry> = {};
  try {
    const res = await fetch('/api/fingerprints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths }),
    });
    if (res.ok) result = (await res.json()) as Record<string, BatchEntry>;
  } catch {
    // Network failure → every path in this batch resolves null; the caller
    // leaves the sealed placeholder facade.
  }
  for (const path of paths) {
    const entry = result[path];
    for (const resolve of pending.get(path) ?? []) resolve(entry ? entry.b64 : null);
  }
}
