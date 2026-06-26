import { describe, it, expect } from 'vitest';
import { formatRelativeAge, humanAge } from '@/utils/dates';

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

  it('returns months for under a year (30-day buckets)', () => {
    expect(formatRelativeAge('2026-03-12', NOW)).toBe('2 months ago');
    expect(formatRelativeAge('2026-04-23', NOW)).toBe('1 month ago');
  });

  it('returns years for one year or more (365-day buckets)', () => {
    expect(formatRelativeAge('2024-05-24', NOW)).toBe('2 years ago');
    expect(formatRelativeAge('2025-05-22', NOW)).toBe('1 year ago');
  });

  it('handles future dates as "just now"', () => {
    expect(formatRelativeAge('2026-05-25T00:00:00Z', NOW)).toBe('just now');
  });
});

describe('humanAge', () => {
  const TO = '2026-05-24';

  it('renders a singular-unit adjective phrase', () => {
    expect(humanAge('2024-05-24', TO)).toBe('2-year-old');
    expect(humanAge('2025-05-24', TO)).toBe('1-year-old');
    expect(humanAge('2026-03-24', TO)).toBe('2-month-old');
    expect(humanAge('2026-05-03', TO)).toBe('3-week-old');
    expect(humanAge('2026-05-20', TO)).toBe('4-day-old');
  });

  it('returns empty string for an unparseable date', () => {
    expect(humanAge('not-a-date', TO)).toBe('');
  });
});
