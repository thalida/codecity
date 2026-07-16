// api/file.ts — endpoint helpers for /api/file (raw file content reads).

import { apiUrl } from '@/api/apiUrl';

/** URL for the file-content endpoint, scoped to a single absolute path. */
export function fileUrl(path: string): string {
  return apiUrl('file', { path });
}

/**
 * Fetch the raw text body for a file. Throws on non-2xx. Used by infoPane
 * (README rendering) and filePreviewPane (syntax-highlighted preview).
 */
export async function fetchFileText(path: string): Promise<string> {
  const resp = await fetch(fileUrl(path));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

/**
 * Fetch the raw bytes for a file. Throws on non-2xx. Used by the font preview,
 * which sniffs the bytes and builds a FontFace from them directly (rather than
 * pointing FontFace at the URL) so it can reject non-fonts before the browser
 * attempts — and noisily fails — to decode them.
 */
export async function fetchFileBytes(path: string): Promise<ArrayBuffer> {
  const resp = await fetch(fileUrl(path));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.arrayBuffer();
}
