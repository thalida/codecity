// api/file.ts — endpoint helpers for /api/file (raw file content reads).

import { apiUrl } from '@/api/apiUrl';

/** URL for a file's bytes. `sha` pins a git blob (Timeline); without one the
 *  endpoint reads the working tree and `mtime` only busts the browser cache. */
export function fileUrl(path: string, mtime?: string, sha?: string | null): string {
  // A blob sha IS the cache key, so the mtime buster is redundant alongside it.
  return apiUrl('file', sha ? { path, sha } : { path, mtime });
}

/**
 * Fetch the raw text body for a file. Throws on non-2xx. Used by infoPane
 * (README rendering) and filePreviewPane (syntax-highlighted preview). Pass the
 * file's mtime so a live edit re-fetches (see fileUrl).
 */
export async function fetchFileText(
  path: string,
  mtime?: string,
  sha?: string | null
): Promise<string> {
  // High priority: the file preview is the user's active focus, so it should
  // jump ahead of any background manifest/blob fetches in flight.
  const resp = await fetch(fileUrl(path, mtime, sha), { priority: 'high' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

/**
 * Fetch the raw bytes for a file. Throws on non-2xx. Used by the font preview,
 * which sniffs the bytes and builds a FontFace from them directly (rather than
 * pointing FontFace at the URL) so it can reject non-fonts before the browser
 * attempts — and noisily fails — to decode them. Pass the file's mtime so a
 * live edit re-fetches (see fileUrl).
 */
export async function fetchFileBytes(
  path: string,
  mtime?: string,
  sha?: string | null
): Promise<ArrayBuffer> {
  // High priority: same as fetchFileText, the font preview is the active pane.
  const resp = await fetch(fileUrl(path, mtime, sha), { priority: 'high' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.arrayBuffer();
}
