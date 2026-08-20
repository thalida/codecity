// Binary-file fingerprints via POST /api/fingerprints: a base64 byte-pattern
// PNG per path (null when omitted). Coalescing lives in createPathBatcher.

import { createPathBatcher, PENDING } from '@/api/pathBatcher';
import type { Pending } from '@/api/pathBatcher';
import type { components } from '@/types/manifest.generated';

type FingerprintEntry =
  components['schemas']['FingerprintEntry'] | components['schemas']['PendingBatchEntry'];

const batcher = createPathBatcher<string | Pending, FingerprintEntry>({
  endpoint: '/api/fingerprints',
  // An undownloaded file has no byte pattern of its own to draw: the server
  // won't fingerprint the pointer stub standing in for it.
  decode: (entry) => ('status' in entry ? PENDING : entry.b64),
});

/** Request a binary file's fingerprint PNG (base64) via the batch endpoint.
 *  Resolves with the base64 string, PENDING while the bytes are still being
 *  downloaded, or null when the server omitted it. */
export function fetchFingerprintB64(path: string): Promise<string | Pending | null> {
  return batcher.request(path);
}
