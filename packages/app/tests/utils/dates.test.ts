import { describe, it, expect } from 'vitest';
import { formatRelativeAge } from '@/utils/dates';

// Local, like the dates it is measured against: from a UTC instant, these
// answers would depend on the runner's timezone.
const NOW = new Date(2026, 4, 24, 12, 0, 0);

/** A local moment as the ISO string a timestamped date arrives as. */
const iso = (y: number, mo: number, d: number, h = 0, mi = 0, se = 0) =>
  new Date(y, mo, d, h, mi, se).toISOString();

describe('formatRelativeAge', () => {
  it('returns "just now" for a date less than a minute ago', () => {
    expect(formatRelativeAge(iso(2026, 4, 24, 11, 59, 30), NOW)).toBe('just now');
  });

  it('returns minutes for under an hour', () => {
    expect(formatRelativeAge(iso(2026, 4, 24, 11, 55), NOW)).toBe('5 minutes ago');
    expect(formatRelativeAge(iso(2026, 4, 24, 11, 59), NOW)).toBe('1 minute ago');
  });

  it('returns hours for under a day', () => {
    expect(formatRelativeAge(iso(2026, 4, 24, 9), NOW)).toBe('3 hours ago');
    expect(formatRelativeAge(iso(2026, 4, 24, 11), NOW)).toBe('1 hour ago');
  });

  it('returns days for under 30 days', () => {
    expect(formatRelativeAge(iso(2026, 4, 21, 12), NOW)).toBe('3 days ago');
    expect(formatRelativeAge(iso(2026, 4, 23, 12), NOW)).toBe('1 day ago');
  });

  it('accepts day-precision YYYY-MM-DD input', () => {
    expect(formatRelativeAge('2026-05-21', NOW)).toBe('3 days ago');
  });

  it('shows two calendar-accurate units for month-scale gaps', () => {
    expect(formatRelativeAge('2026-03-12', NOW)).toBe('2 months 12 days ago');
    expect(formatRelativeAge('2026-04-23', NOW)).toBe('1 month 1 day ago');
  });

  it('shows two units for year-scale gaps, dropping zero units', () => {
    // Exact anniversary → just the year (zero months + days dropped).
    expect(formatRelativeAge('2024-05-24', NOW)).toBe('2 years ago');
    // Year + a month gap, kept together (the gap that a single-unit format lost).
    expect(formatRelativeAge('2023-01-24', NOW)).toBe('3 years 4 months ago');
    // Zero-month gap is skipped so the next non-zero unit still shows.
    expect(formatRelativeAge('2025-05-22', NOW)).toBe('1 year 2 days ago');
  });

  it('handles future dates as "just now"', () => {
    expect(formatRelativeAge('2026-05-25T00:00:00Z', NOW)).toBe('just now');
  });
});
