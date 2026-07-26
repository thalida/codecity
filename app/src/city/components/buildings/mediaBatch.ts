// city/components/buildings/mediaBatch.ts — coalesces media-image fetches into
// POST /api/files batches. The scene loads one billboard texture per media
// file; firing a separate GET /api/file per image exhausts the browser's
// HTTP/1.1 connection pool on media-heavy repos (Infisical: 2.6k images), so we
// collect the paths requested within a short window and fetch them in a handful
// of batched requests instead of thousands of singletons.
//
// The caller gets back a Blob it wraps in an object URL and feeds to the
// existing <img> decode path — so SVGs, color profiles, etc. still render
// through the browser exactly as a direct GET would. A path the batch endpoint
// omits (non-image, too large, out of root) resolves to null; the caller then
// falls back to the streaming GET /api/file for that one file.

/** Max paths per POST /api/files request — mirrors the server-side cap so a
 *  single batch response stays bounded. */
const BATCH_SIZE = 32;
/** Coalescing window: media buildings register in a burst at scene build, so a
 *  one-frame delay gathers essentially all of them before the first flush. */
const FLUSH_MS = 16;

interface BatchEntry {
  mime: string;
  b64: string;
}

type Waiter = (blob: Blob | null) => void;

const _queue = new Map<string, Waiter[]>();
let _timer: ReturnType<typeof setTimeout> | null = null;

/** Request a media image's bytes via the batch endpoint. Resolves with a Blob
 *  (use URL.createObjectURL + revoke), or null when the server omitted it. */
export function fetchMediaBlob(path: string, sha?: string | null): Promise<Blob | null> {
  return new Promise((resolve) => {
    const waiters = _queue.get(path);
    if (waiters) {
      waiters.push(resolve);
    } else {
      _queue.set(path, [resolve]);
    }
    if (sha) _shas.set(path, sha);
    if (_timer === null) _timer = setTimeout(_flush, FLUSH_MS);
  });
}

// path -> blob sha for the scrubbed commit; empty in Live.
const _shas = new Map<string, string>();

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
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths, shas: _shasFor(paths) }),
    });
    if (res.ok) result = (await res.json()) as Record<string, BatchEntry>;
  } catch {
    // Network failure → every path in this batch resolves null; callers fall
    // back to the individual GET path.
  }
  for (const path of paths) {
    const entry = result[path];
    const blob = entry ? _decode(entry) : null;
    _shas.delete(path);
    for (const resolve of pending.get(path) ?? []) resolve(blob);
  }
}

function _shasFor(paths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of paths) {
    const sha = _shas.get(p);
    if (sha) out[p] = sha;
  }
  return out;
}

function _decode(entry: BatchEntry): Blob | null {
  try {
    const bin = atob(entry.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: entry.mime });
  } catch {
    return null;
  }
}
