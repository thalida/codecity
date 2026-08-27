// utils/dates.ts — the parse rule the layout encoders read dates by: a date is
// a moment in the reader's timezone, and a day-precision string is that day
// where they are. The app keeps the formatters that print them.

const MS_MINUTE = 60_000;
const MS_DAY = 24 * 60 * MS_MINUTE;

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
