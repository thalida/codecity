// api/fingerprint.ts — endpoint helpers for /api/fingerprint, the byte-pattern
// image a binary file wears. The image is computed server-side: raw binary
// never reaches the client, only the picture of its byte distribution.

import { apiUrl } from '@/api/apiUrl';
import { fetchContent } from '@/api/file';

/** URL for a binary file's fingerprint PNG. `mtime` versions it, so an edit
 *  re-fingerprints and an unchanged file is served from the browser cache. */
export function fingerprintUrl(path: string, mtime?: string): string {
  return apiUrl('fingerprint', { path, mtime });
}

/** A binary file's fingerprint PNG. Throws ContentPendingError for a file not
 *  downloaded yet: the server won't fingerprint the pointer stub standing in. */
export async function fetchFingerprintBlob(path: string, mtime?: string): Promise<Blob> {
  return (await fetchContent(fingerprintUrl(path, mtime))).blob();
}
