// utils/bytes.ts — Byte-count formatting. Common display logic used by
// any UI that surfaces file/directory size.

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

/**
 * Format a byte count into a human-readable string. e.g. "512 B", "3.4 KB", "1.2 MB".
 */
export function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}
