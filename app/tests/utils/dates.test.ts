import { describe, it, expect } from 'vitest';
import { formatRelativeAge, humanSpan } from '@/utils/dates';

const NOW = new Date('2026-05-24T12:00:00Z');

describe('formatRelativeAge', () => {
  it('returns "just now" for a date less than a minute ago', () => {
    expect(formatRelativeAge('2026-05-24T11:59:30Z', NOW)).toBe('just now');
  });

  it('returns minutes for under an hour', () => {
    expect(formatRelativeAge('2026-05-24T11:55:00Z', NOW)).toBe('5 minutes ago');
    expect(formatRelativeAge('2026-05-24T11:59:00Z', NOW)).toBe('1 minute ago');
  });

  it('returns hours for under a day', () => {
    expect(formatRelativeAge('2026-05-24T09:00:00Z', NOW)).toBe('3 hours ago');
    expect(formatRelativeAge('2026-05-24T11:00:00Z', NOW)).toBe('1 hour ago');
  });

  it('returns days for under 30 days', () => {
    expect(formatRelativeAge('2026-05-21T12:00:00Z', NOW)).toBe('3 days ago');
    expect(formatRelativeAge('2026-05-23T12:00:00Z', NOW)).toBe('1 day ago');
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

describe('humanSpan', () => {
  it('renders up to two calendar-accurate units', () => {
    expect(humanSpan('2024-01-10', '2026-05-24')).toBe('2 years 4 months');
    expect(humanSpan('2026-03-12', '2026-05-24')).toBe('2 months 12 days');
    expect(humanSpan('2026-05-20', '2026-05-24')).toBe('4 days');
  });
  it('order-independent, min one day, empty on bad input', () => {
    expect(humanSpan('2026-05-24', '2026-03-12')).toBe('2 months 12 days');
    expect(humanSpan('2026-05-24', '2026-05-24')).toBe('1 day');
    expect(humanSpan('nope', '2026-05-24')).toBe('');
  });
});

