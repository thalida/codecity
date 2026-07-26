// api/fingerprint.ts — binary-file fingerprints via POST /api/fingerprints.
// The server returns a small base64 byte-pattern PNG per path; callers feed it
// to an <img> via a data URL. A path the endpoint omits resolves to null.
// Shared by the city's data-building facade loader and the preview pane's data
// card. Coalescing lives in createPathBatcher, shared with mediaBatch.

import { createPathBatcher } from '@/api/pathBatcher';

interface FingerprintEntry {
  b64: string;
}

const batcher = createPathBatcher<string, FingerprintEntry>({
  endpoint: '/api/fingerprints',
  decode: (entry) => entry.b64,
});

/** Request a binary file's fingerprint PNG (base64) via the batch endpoint.
 *  Resolves with the base64 string, or null when the server omitted it. */
export function fetchFingerprintB64(path: string): Promise<string | null> {
  return batcher.request(path);
}
