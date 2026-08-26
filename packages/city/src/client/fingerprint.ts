// client/fingerprint.ts — endpoint helpers for /api/fingerprint, the byte-pattern
// image a binary file wears. The image is computed server-side: raw binary
// never reaches the client, only the picture of its byte distribution.

import type { SourceRef } from '@/types';
import type { ApiUrl } from './url';

export function createFingerprintEndpoints(
  apiUrl: ApiUrl,
  fetchContent: ReturnType<typeof import('./file').createFileEndpoints>['fetchContent']
) {
  /** URL for a binary file's fingerprint PNG, addressed like /api/file. `mtime`
   *  versions it, so an edit re-fingerprints and an unchanged file stays cached. */
  function fingerprintUrl(source: SourceRef, path: string, mtime?: string): string {
    return apiUrl('fingerprint', {
      src: source.src,
      branch: source.branch ?? undefined,
      path,
      mtime,
    });
  }

  /** A binary file's fingerprint PNG. Throws ContentPendingError for a file not
   *  downloaded yet: the server won't fingerprint the pointer stub standing in. */
  async function fetchFingerprintBlob(
    source: SourceRef,
    path: string,
    mtime?: string
  ): Promise<Blob> {
    return (await fetchContent(fingerprintUrl(source, path, mtime))).blob();
  }

  return {
    fingerprintUrl,
    fetchFingerprintBlob,
  };
}
