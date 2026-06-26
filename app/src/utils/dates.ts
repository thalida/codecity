// utils/dates.ts — Date formatting helpers shared across the UI.
//
// All public functions take a string (typically ISO 8601 or YYYY-MM-DD)
// and return display-ready text. They never throw — invalid input falls
// back to the raw string so the UI degrades gracefully.
//
// Two relative-age formatters live here on purpose:
//   - formatRelativeAge      — long form ("3 days ago"). Used where there's
//                              room: commit metadata, hover tooltips.
//   - formatRelativeAgeShort — short form ("3d ago"). Used in compact rows:
//                              the app footer, status chips.
//
// Two absolute formatters live here on purpose:
//   - formatFullDate         — long form ("March 12, 2026"). Used in
//                              tooltips where the full month name reads
//                              naturally.
//   - formatShortDate        — short form ("Mar 12, 2026"). Used inline
//                              where space is tighter.

const MS_SECOND = 1_000;
const MS_MINUTE = 60_000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;
const MS_MONTH = 30 * MS_DAY;
const MS_YEAR = 365 * MS_DAY;

// ── Parsing ──────────────────────────────────────────────────────────────

/** Parse a date string into local-midnight if it's YYYY-MM-DD, otherwise
 *  delegate to the native `Date` constructor. Day-precision strings parsed
 *  via `new Date('YYYY-MM-DD')` land at UTC midnight, which can shift to
 *  the previous calendar day in negative timezones — using local components
 *  keeps the displayed day matching the source string. Returns null if the
 *  result is invalid. */
function parseLocalDate(input: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ── Absolute formatters (calendar dates) ─────────────────────────────────

const FULL_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
};

const SHORT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

/** Format a date string as a long calendar date (e.g. "March 12, 2026").
 *  YYYY-MM-DD input is parsed as local midnight to avoid timezone shift.
 *  Falls back to the raw input if parsing fails. */
export function formatFullDate(input: string): string {
  const date = parseLocalDate(input);
  return date ? date.toLocaleDateString(undefined, FULL_DATE_OPTIONS) : input;
}

/** Format a date string as a short calendar date (e.g. "Mar 12, 2026").
 *  Same parsing rules as `formatFullDate`. Falls back to the raw input
 *  if parsing fails. */
export function formatShortDate(input: string): string {
  const date = parseLocalDate(input);
  return date ? date.toLocaleDateString('en-US', SHORT_DATE_OPTIONS) : input;
}

// ── Relative formatters ──────────────────────────────────────────────────

function pluralizeAgo(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/** Format a date string as an English relative-age ("3 days ago",
 *  "1 minute ago", "just now"). YYYY-MM-DD is treated as UTC midnight so
 *  the threshold buckets ('day', 'month', 'year') are deterministic. */
export function formatRelativeAge(dateStr: string, now: Date = new Date()): string {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00Z` : dateStr;
  const then = new Date(iso).getTime();
  const diff = now.getTime() - then;
  if (diff < MS_MINUTE) return 'just now';
  if (diff < MS_HOUR) return pluralizeAgo(Math.floor(diff / MS_MINUTE), 'minute');
  if (diff < MS_DAY) return pluralizeAgo(Math.floor(diff / MS_HOUR), 'hour');
  if (diff < MS_MONTH) return pluralizeAgo(Math.floor(diff / MS_DAY), 'day');
  if (diff < MS_YEAR) return pluralizeAgo(Math.floor(diff / MS_MONTH), 'month');
  return pluralizeAgo(Math.floor(diff / MS_YEAR), 'year');
}

/** Compact relative-time formatter ("3d ago", "5m ago", "just now"). Takes
 *  millisecond timestamps (not strings) since callers already have
 *  `Date.now()`-style values. Used by the app footer where horizontal
 *  space is tight; second-granularity bucket fires under 5 seconds. */
export function formatRelativeAgeShort(thenMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - thenMs);
  if (diff < 5 * MS_SECOND) return 'just now';
  if (diff < MS_MINUTE) return `${Math.floor(diff / MS_SECOND)}s ago`;
  if (diff < MS_HOUR) return `${Math.floor(diff / MS_MINUTE)}m ago`;
  if (diff < MS_DAY) return `${Math.floor(diff / MS_HOUR)}h ago`;
  if (diff < MS_MONTH) return `${Math.floor(diff / MS_DAY)}d ago`;
  if (diff < MS_YEAR) return `${Math.floor(diff / MS_MONTH)}mo ago`;
  return `${Math.floor(diff / MS_YEAR)}y ago`;
}

/** Coarse human duration between two dates, one unit only ("2 years",
 *  "5 months", "3 weeks", "4 days"). Deterministic (no "now"), so it's safe for
 *  spans/ages in pure view-models. Returns '' if either date is unparseable. */
export function humanSpan(fromISO: string, toISO: string): string {
  const a = parseLocalDate(fromISO);
  const b = parseLocalDate(toISO);
  if (!a || !b) return '';
  const diff = Math.max(0, b.getTime() - a.getTime());
  const unit = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'}`;
  if (diff >= MS_YEAR) return unit(Math.round(diff / MS_YEAR), 'year');
  if (diff >= MS_MONTH) return unit(Math.round(diff / MS_MONTH), 'month');
  if (diff >= 7 * MS_DAY) return unit(Math.round(diff / (7 * MS_DAY)), 'week');
  return unit(Math.max(1, Math.round(diff / MS_DAY)), 'day');
}

/** Age as an adjective phrase relative to a reference date ("2-year-old",
 *  "5-month-old", "3-week-old", "4-day-old"). Built on humanSpan, so it shares
 *  the same coarse single-unit bucket. Returns '' if `fromISO` is unparseable. */
export function humanAge(fromISO: string, toISO: string): string {
  const span = humanSpan(fromISO, toISO); // "2 years"
  if (!span) return '';
  const [n, unit] = span.split(' ');
  return `${n}-${unit.replace(/s$/, '')}-old`;
}

/** ISO date string → epoch ms; NaN for missing/unparseable (so it never wins a
 *  max() comparison). */
export function dateMs(iso: string | null | undefined): number {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? NaN : t;
}
