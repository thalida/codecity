// api/file.ts — endpoint helpers for /api/file (raw file content reads).

import { apiUrl } from '@/api/apiUrl';
import type { components } from '@/types/manifest.generated';
import type { SourceRef } from '@/types';

/** URL for a file's bytes: a repo-relative path plus the source it is relative
 *  to. `sha` pins a git blob (Timeline), else `mtime` versions the working tree. */
export function fileUrl(
  source: SourceRef,
  path: string,
  mtime?: string,
  sha?: string | null
): string {
  const repo = { src: source.src, branch: source.branch ?? undefined };
  // A blob sha IS the version, so the mtime is redundant alongside it.
  return apiUrl('file', sha ? { ...repo, path, sha } : { ...repo, path, mtime });
}

// The server knows the file and hasn't got its bytes yet: an unpulled Git LFS
// object, or history a blobless clone hasn't backfilled. A wait, not a failure.
const PENDING_STATUS = 202;

const PENDING_FALLBACK = 'This file has not been downloaded yet.';

/** Thrown rather than a plain Error so a wait can be told from a failure, with
 *  the server's wording for WHICH fetch is outstanding. */
export class ContentPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentPendingError';
  }
}

/** Content, or the reason there is none: ContentPendingError while the bytes
 *  are still being fetched, a plain Error on any other non-2xx. */
export async function fetchContent(
  url: string,
  // 'high' for a pane the user is looking at, so it jumps the queue of
  // background manifest and facade fetches in flight.
  priority: RequestPriority = 'auto'
): Promise<Response> {
  const resp = await fetch(url, { priority });
  if (resp.status === PENDING_STATUS) {
    const pending = (await resp.json().catch(() => null)) as
      components['schemas']['ContentPendingResponse'] | null;
    throw new ContentPendingError(pending?.message || PENDING_FALLBACK);
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp;
}

/** Whether the bytes are still being fetched, for the loaders that can't see a
 *  status: an <img> or <video> reports only that it didn't load. */
export async function isContentPending(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url);
    // Cancelled at the status line, so probing a 200MB video streams none of it.
    await resp.body?.cancel();
    return resp.status === PENDING_STATUS;
  } catch {
    return false;
  }
}

/** A file's text, for the README render and the code preview. Pass the file's
 *  mtime so a live edit re-fetches (see fileUrl). */
export async function fetchFileText(
  source: SourceRef,
  path: string,
  mtime?: string,
  sha?: string | null
): Promise<string> {
  return (await fetchContent(fileUrl(source, path, mtime, sha), 'high')).text();
}

/** A file's raw bytes. The font preview sniffs them and builds a FontFace
 *  directly, so it can reject a non-font before the browser fails to decode. */
export async function fetchFileBytes(
  source: SourceRef,
  path: string,
  mtime?: string,
  sha?: string | null
): Promise<ArrayBuffer> {
  return (await fetchContent(fileUrl(source, path, mtime, sha), 'high')).arrayBuffer();
}

/** A file's bytes as a Blob, for the facade loaders. Default priority: a city's
 *  worth of billboards must not outrank the pane in front of them. */
export async function fetchFileBlob(
  source: SourceRef,
  path: string,
  mtime?: string,
  sha?: string | null
): Promise<Blob> {
  return (await fetchContent(fileUrl(source, path, mtime, sha))).blob();
}
