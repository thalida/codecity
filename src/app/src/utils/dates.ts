// utils/dates.ts — every date the app reads or prints goes through here, on one
// parse rule: a date is a moment in the reader's timezone, and a day-precision
// string is that day where they are. Two rules is how a commit made in the
// evening is labelled one day on an axis and the next day under the handle.

const MS_SECOND = 1_000;
const MS_MINUTE = 60_000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;
const MS_MONTH = 30 * MS_DAY;
const MS_YEAR = 365 * MS_DAY;

// ── Parsing ──────────────────────────────────────────────────────────────

/** Local midnight for a day-precision string, native parse otherwise: through
 *  `new Date`, a bare date lands at UTC midnight and can show the day before. */
export function parseLocalDate(input: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `parseLocalDate` as milliseconds, NaN when unparseable: anything turning a
 *  date into a position has to read it the way the labels do. */
export function parseDateMs(input: string): number {
  return parseLocalDate(input)?.getTime() ?? NaN;
}

/** The local calendar day as a day number, fractional through the day: the
 *  scene ages in whole days, and they have to be the days the labels print. */
export function epochDayAt(ms: number): number {
  return (ms - new Date(ms).getTimezoneOffset() * MS_MINUTE) / MS_DAY;
}

/** `epochDayAt` for a date string, floored to the whole day. NaN when
 *  unparseable, so callers can pick their own fallback. */
export function epochDay(input: string): number {
  const ms = parseDateMs(input);
  return Number.isNaN(ms) ? NaN : Math.floor(epochDayAt(ms));
}

/** The local calendar day a moment falls on. toISOString would name the UTC
 *  day, which for part of every day is the date beside it plus one. */
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

/** A long calendar date ("March 12, 2026"), or the raw input if it won't
 *  parse, so the UI degrades rather than printing nothing. */
export function formatFullDate(input: string): string {
  const date = parseLocalDate(input);
  return date ? date.toLocaleDateString(undefined, FULL_DATE_OPTIONS) : input;
}

/** A short calendar date ("Mar 12, 2026"), same rules as formatFullDate. */
export function formatShortDate(input: string): string {
  const date = parseLocalDate(input);
  return date ? date.toLocaleDateString('en-US', SHORT_DATE_OPTIONS) : input;
}

// ── Relative formatters ──────────────────────────────────────────────────

function pluralizeAgo(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/** Whole years/months/days, on real month lengths rather than 30-day buckets,
 *  which lose a month between two dates in the same year. */
function _calendarSpan(from: Date, to: Date): { years: number; months: number; days: number } {
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  let days = to.getDate() - from.getDate();
  if (days < 0) {
    // Borrow days from the month before `to` (day 0 = last day of prev month).
    days += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }
  return { years, months, days };
}

/** The largest `max` non-zero units, so an exact anniversary is "2 years"
 *  rather than "2 years 0 months". Empty for a sub-day span. */
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

/** A relative age: one coarse unit under a day, two calendar-accurate ones
 *  above it ("2 years 4 months ago"). */
export function formatRelativeAge(dateStr: string, now: Date = new Date()): string {
  const then = parseLocalDate(dateStr);
  if (!then) return dateStr;
  const diff = now.getTime() - then.getTime();
  if (diff < MS_MINUTE) return 'just now';
  if (diff < MS_HOUR) return pluralizeAgo(Math.floor(diff / MS_MINUTE), 'minute');
  if (diff < MS_DAY) return pluralizeAgo(Math.floor(diff / MS_HOUR), 'hour');
  // A day or more: calendar-accurate, up to two units. Local components, since
  // parseLocalDate built a local date.
  return `${_joinSpan(_calendarSpan(then, now), 2) || '1 day'} ago`;
}

/** The compact form ("3d ago"), in milliseconds since its callers already
 *  hold those, for rows with no horizontal room. */
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

/** A duration between two dates, to two units. Takes no "now", so it is safe
 *  in a pure view-model; '' if either date won't parse. */
export function humanSpan(fromISO: string, toISO: string): string {
  const a = parseLocalDate(fromISO);
  const b = parseLocalDate(toISO);
  if (!a || !b) return '';
  const [from, to] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
  return _joinSpan(_calendarSpan(from, to), 2) || '1 day';
}
