// views/widgets/formatRelativeAge.ts — render a date as an English
// relative-age string ("3 days ago", "2 months ago", "1 year ago").
// Day-precision input ("YYYY-MM-DD") is treated as midnight UTC.

const MS_MINUTE = 60_000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;
const MS_MONTH = 30 * MS_DAY;
const MS_YEAR = 365 * MS_DAY;

function pluralize(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

export function formatRelativeAge(dateStr: string, now: Date = new Date()): string {
  // YYYY-MM-DD → midnight UTC; ISO strings parse as-is.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00Z` : dateStr;
  const then = new Date(iso).getTime();
  const diff = now.getTime() - then;
  if (diff < MS_MINUTE) return 'just now';
  if (diff < MS_HOUR) return pluralize(Math.floor(diff / MS_MINUTE), 'minute');
  if (diff < MS_DAY) return pluralize(Math.floor(diff / MS_HOUR), 'hour');
  if (diff < MS_MONTH) return pluralize(Math.floor(diff / MS_DAY), 'day');
  if (diff < MS_YEAR) return pluralize(Math.floor(diff / MS_MONTH), 'month');
  return pluralize(Math.floor(diff / MS_YEAR), 'year');
}
