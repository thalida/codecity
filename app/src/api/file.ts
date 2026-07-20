// api/file.ts — endpoint helpers for /api/file (raw file content reads).

import { apiUrl } from '@/api/apiUrl';

/**
 * URL for the file-content endpoint, scoped to a single absolute path.
 * `version` (a file's mtime) is a cache-buster: the endpoint ignores it, but a
 * distinct URL forces the browser to re-fetch after a live edit instead of
 * serving the old body for the unchanged path. Omitted → same URL as before.
 */
export function fileUrl(path: string, version?: string): string {
  return apiUrl('file', { path, v: version });
}

/**
 * Fetch the raw text body for a file. Throws on non-2xx. Used by infoPane
 * (README rendering) and filePreviewPane (syntax-highlighted preview). Pass the
 * file's mtime as `version` so a live edit re-fetches (see fileUrl).
 */
export async function fetchFileText(path: string, version?: string): Promise<string> {
  const resp = await fetch(fileUrl(path, version));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

/**
 * Fetch the raw bytes for a file. Throws on non-2xx. Used by the font preview,
 * which sniffs the bytes and builds a FontFace from them directly (rather than
 * pointing FontFace at the URL) so it can reject non-fonts before the browser
 * attempts — and noisily fails — to decode them. Pass the file's mtime as
 * `version` so a live edit re-fetches (see fileUrl).
 */
export async function fetchFileBytes(path: string, version?: string): Promise<ArrayBuffer> {
  const resp = await fetch(fileUrl(path, version));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.arrayBuffer();
}
