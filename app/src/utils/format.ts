// utils/format.ts — small number/string formatting helpers shared across views.

/** Integer with thousands separators ("1,843"). */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** "3 files" / "1 file" — comma-formats the count and pluralizes the noun. */
export function pluralize(n: number, noun: string): string {
  return `${formatCount(n)} ${noun}${n === 1 ? '' : 's'}`;
}
