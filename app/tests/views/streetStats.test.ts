import { describe, it, expect } from 'vitest';
import {
  extBarPct,
  extShareLabel,
  extTypeLabel,
  streetDateRange,
} from '@/views/StreetPane/streetStats';

describe('extBarPct', () => {
  it('is 100 when one extension is all the files', () => {
    expect(extBarPct(98, 98)).toBe(100);
  });
  it('is the share of the total (half of all files → 50%)', () => {
    expect(extBarPct(49, 98)).toBe(50);
  });
  it('floors a tiny share to a visible sliver (4%)', () => {
    expect(extBarPct(1, 1000)).toBe(4);
  });
  it('is 0 when the total is non-positive', () => {
    expect(extBarPct(5, 0)).toBe(0);
    expect(extBarPct(0, 0)).toBe(0);
  });
});

describe('extShareLabel', () => {
  it('formats a share as a rounded percent', () => {
    expect(extShareLabel(7, 11)).toBe('64%');
    expect(extShareLabel(1, 2)).toBe('50%');
  });
  it('shows <1% for a nonzero share that rounds to zero', () => {
    expect(extShareLabel(1, 1000)).toBe('<1%');
  });
  it('is 0% when the total is non-positive', () => {
    expect(extShareLabel(0, 0)).toBe('0%');
  });
});

describe('extTypeLabel', () => {
  it('names a known extension with the language label + ext', () => {
    expect(extTypeLabel('.ts')).toBe('TypeScript (.ts)');
  });
  it('uppercases an unknown extension', () => {
    expect(extTypeLabel('.sketch')).toBe('SKETCH (.sketch)');
  });
  it('labels the (none) sentinel as "No extension"', () => {
    expect(extTypeLabel('(none)')).toBe('No extension');
  });
});

describe('streetDateRange', () => {
  it('formats an oldest→newest span', () => {
    expect(streetDateRange('2024-03-12', '2026-06-20')).toBe('Mar 12, 2024 → Jun 20, 2026');
  });
  it('collapses to one date when oldest and newest are equal', () => {
    expect(streetDateRange('2024-03-12', '2024-03-12')).toBe('Mar 12, 2024');
  });
  it('is null when either date is missing', () => {
    expect(streetDateRange(null, '2026-06-20')).toBeNull();
    expect(streetDateRange('2024-03-12', null)).toBeNull();
  });
});
