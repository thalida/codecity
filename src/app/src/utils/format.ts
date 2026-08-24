// utils/format.ts — numbers and counts as a person reads them, shared across
// every view that prints one.

/** Integer with thousands separators ("1,843"). */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** "3 files" / "1 file" — comma-formats the count and pluralizes the noun. */
export function pluralize(n: number, noun: string): string {
  return `${formatCount(n)} ${noun}${n === 1 ? '' : 's'}`;
}

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

/** "512 B", "3.4 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}
