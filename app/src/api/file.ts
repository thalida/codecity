// api/file.ts — endpoint helpers for /api/file (raw file content reads).

import { apiUrl } from '@/api/apiUrl';
import type { components } from '@/types/manifest.generated';

/** URL for a file's bytes. `sha` pins a git blob (Timeline); without one the
 *  endpoint reads the working tree and `mtime` only busts the browser cache. */
export function fileUrl(path: string, mtime?: string, sha?: string | null): string {
  // A blob sha IS the cache key, so the mtime buster is redundant alongside it.
  return apiUrl('file', sha ? { path, sha } : { path, mtime });
}

// 202: the server knows this file, it just doesn't have the bytes yet (an
// unpulled Git LFS object, history a blobless clone hasn't backfilled). A wait,
// not a failure, and the same request succeeds once the fetch behind it lands.
const PENDING_STATUS = 202;

const PENDING_FALLBACK = 'This file has not been downloaded yet.';

/** Thrown instead of a plain Error so a wait can be told from a failure, and
 *  so the server's wording for WHICH fetch is outstanding survives the throw. */
export class ContentPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentPendingError';
  }
}

/**
 * The response for a file's bytes. Throws {@link ContentPendingError} while the
 * content is still being fetched, a plain Error on any other non-2xx.
 *
 * High priority: a preview is the user's active focus, so it should jump ahead
 * of any background manifest/blob fetches in flight.
 */
async function _fetchFile(path: string, mtime?: string, sha?: string | null): Promise<Response> {
  const resp = await fetch(fileUrl(path, mtime, sha), { priority: 'high' });
  if (resp.status === PENDING_STATUS) {
    const pending = (await resp.json().catch(() => null)) as
      components['schemas']['ContentPendingResponse'] | null;
    throw new ContentPendingError(pending?.message || PENDING_FALLBACK);
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp;
}

/**
 * Fetch content and hand back the response, so every caller answers a wait the
 * same way: {@link ContentPendingError} while the bytes are still being
 * fetched, a plain Error on any other non-2xx.
 *
 * `priority` is 'high' for a pane the user is looking at, so it jumps ahead of
 * the background manifest and facade fetches in flight.
 */
export async function fetchContent(
  url: string,
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

/**
 * Whether the endpoint is still fetching this file's bytes, for the loaders
 * that can't see a status: an <img> or <video> reports only that it didn't
 * load, and "not downloaded yet" must not be painted as a failure. The body is
 * cancelled the moment the status line arrives, so probing a 200MB video
 * streams none of it.
 */
export async function isContentPending(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url);
    await resp.body?.cancel();
    return resp.status === PENDING_STATUS;
  } catch {
    return false;
  }
}

/**
 * Fetch the raw text body for a file. Used by infoPane (README rendering) and
 * filePreviewPane (syntax-highlighted preview). Pass the file's mtime so a live
 * edit re-fetches (see fileUrl).
 */
export async function fetchFileText(
  path: string,
  mtime?: string,
  sha?: string | null
): Promise<string> {
  return (await fetchContent(fileUrl(path, mtime, sha), 'high')).text();
}

/**
 * Fetch the raw bytes for a file. Used by the font preview, which sniffs the
 * bytes and builds a FontFace from them directly (rather than pointing FontFace
 * at the URL) so it can reject non-fonts before the browser attempts — and
 * noisily fails — to decode them. Pass the file's mtime so a live edit
 * re-fetches (see fileUrl).
 */
export async function fetchFileBytes(
  path: string,
  mtime?: string,
  sha?: string | null
): Promise<ArrayBuffer> {
  return (await fetchContent(fileUrl(path, mtime, sha), 'high')).arrayBuffer();
}

/**
 * Fetch a file's bytes as a Blob, for the facade loaders: the caller wraps it
 * in an object URL and feeds the existing <img> decode path, so SVGs, color
 * profiles and the rest render exactly as a direct GET would. Default priority
 * — a city's worth of billboards must not outrank the pane in front of them.
 */
export async function fetchFileBlob(
  path: string,
  mtime?: string,
  sha?: string | null
): Promise<Blob> {
  return (await fetchContent(fileUrl(path, mtime, sha))).blob();
}
