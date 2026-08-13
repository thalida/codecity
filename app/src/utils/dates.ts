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
export function parseLocalDate(input: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `parseLocalDate` as milliseconds, NaN when unparseable. Anything that turns
 *  a date into a position and back has to parse it the way the labels do, or
 *  the two disagree by a timezone. */
export function parseDateMs(input: string): number {
  return parseLocalDate(input)?.getTime() ?? NaN;
}

/** The calendar day (YYYY-MM-DD) a moment falls on, in the reader's timezone.
 *  Every date the UI prints is local, so a day derived from a timestamp has to
 *  be read the same way: toISOString names the UTC day, which for part of every
 *  day is a different date than the one shown beside it. */
export function localDay(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

/** Whole years/months/days from `from` to `to` (to >= from), calendar-accurate
 *  (real month lengths, not fixed 30/365-day buckets — so month gaps between two
 *  same-year dates aren't lost). `utc` picks UTC vs local component reads and MUST
 *  match how the two Dates were parsed, or the day arithmetic drifts by the tz. */
function _calendarSpan(
  from: Date,
  to: Date,
  utc: boolean
): { years: number; months: number; days: number } {
  const y = (d: Date) => (utc ? d.getUTCFullYear() : d.getFullYear());
  const mo = (d: Date) => (utc ? d.getUTCMonth() : d.getMonth());
  const dy = (d: Date) => (utc ? d.getUTCDate() : d.getDate());
  let years = y(to) - y(from);
  let months = mo(to) - mo(from);
  let days = dy(to) - dy(from);
  if (days < 0) {
    // Borrow days from the month before `to` (day 0 = last day of prev month).
    const prevMonthDays = utc
      ? new Date(Date.UTC(y(to), mo(to), 0)).getUTCDate()
      : new Date(y(to), mo(to), 0).getDate();
    days += prevMonthDays;
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }
  return { years, months, days };
}

/** Join the largest `max` NON-zero units of a calendar span as "2 years 4
 *  months" (zeros are skipped, so an exact anniversary is just "2 years").
 *  Empty string when every unit is zero (a sub-day span). */
function _joinSpan(span: { years: number; months: number; days: number }, max: number): string {
  const parts: [number, string][] = [
    [span.years, 'year'],
    [span.months, 'month'],
    [span.days, 'day'],
  ];
  return parts
    .filter(([n]) => n > 0)
    .slice(0, max)
    .map(([n, u]) => `${n} ${u}${n === 1 ? '' : 's'}`)
    .join(' ');
}

/** Format a date string as an English relative-age. Under a day it's a single
 *  coarse unit ("just now", "5 minutes ago", "3 hours ago"); a day or more is
 *  calendar-accurate to two units ("2 years 4 months ago", "5 months 12 days
 *  ago", "3 days ago"). YYYY-MM-DD is treated as UTC midnight so the result is
 *  timezone-deterministic. */
export function formatRelativeAge(dateStr: string, now: Date = new Date()): string {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00Z` : dateStr;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return dateStr;
  const diff = now.getTime() - then.getTime();
  if (diff < MS_MINUTE) return 'just now';
  if (diff < MS_HOUR) return pluralizeAgo(Math.floor(diff / MS_MINUTE), 'minute');
  if (diff < MS_DAY) return pluralizeAgo(Math.floor(diff / MS_HOUR), 'hour');
  // A day or more: calendar-accurate, up to two units.
  return `${_joinSpan(_calendarSpan(then, now, true), 2) || '1 day'} ago`;
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

/** Human duration between two dates, calendar-accurate to two units ("2 years
 *  4 months", "5 months 12 days", "3 days"). Deterministic (no "now"), so it's
 *  safe for spans in pure view-models. Returns '' if either date is unparseable. */
export function humanSpan(fromISO: string, toISO: string): string {
  const a = parseLocalDate(fromISO);
  const b = parseLocalDate(toISO);
  if (!a || !b) return '';
  const [from, to] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
  // parseLocalDate builds LOCAL-midnight dates, so read local components.
  return _joinSpan(_calendarSpan(from, to, false), 2) || '1 day';
}
