// city/components/buildings/mediaBatch.ts — media images via POST /api/images.
//
// The caller gets back a Blob it wraps in an object URL and feeds to the
// existing <img> decode path, so SVGs, color profiles, etc. still render
// through the browser exactly as a direct GET would. A path the batch endpoint
// omits (non-image, too large, out of root) resolves to null; the caller then
// falls back to the streaming GET /api/file for that one file.
//
// Coalescing lives in createPathBatcher, shared with the fingerprint batcher.

import { createPathBatcher, PENDING } from '@/api/pathBatcher';
import type { Pending } from '@/api/pathBatcher';
import type { components } from '@/types/manifest.generated';

type MediaEntry =
  components['schemas']['ImageBatchEntry'] | components['schemas']['PendingBatchEntry'];

// path -> blob sha for the scrubbed commit; empty in Live.
const shas = new Map<string, string>();

function shasFor(paths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of paths) {
    const sha = shas.get(path);
    if (sha) out[path] = sha;
  }
  return out;
}

function decodeBlob(entry: MediaEntry): Blob | Pending | null {
  if ('status' in entry) return PENDING;
  try {
    const bin = atob(entry.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: entry.mime });
  } catch {
    return null;
  }
}

const batcher = createPathBatcher<Blob | Pending, MediaEntry>({
  endpoint: '/api/images',
  decode: decodeBlob,
  bodyFor: (paths) => ({ shas: shasFor(paths) }),
  onSettled: (path) => shas.delete(path),
});

/** Request a media image's bytes via the batch endpoint. Resolves with a Blob
 *  (use URL.createObjectURL + revoke), PENDING while the bytes are still being
 *  downloaded, or null when the server omitted it. */
export function fetchMediaBlob(path: string, sha?: string | null): Promise<Blob | Pending | null> {
  // Recorded before the request so the sha is present when the batch flushes.
  if (sha) shas.set(path, sha);
  return batcher.request(path);
}
