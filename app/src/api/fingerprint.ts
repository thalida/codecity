// Binary-file fingerprints via POST /api/fingerprints: a base64 byte-pattern
// PNG per path (null when omitted). Coalescing lives in createPathBatcher.

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
