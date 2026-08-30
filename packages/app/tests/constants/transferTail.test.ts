// The clone/backfill tail. Git reports a percent that barely moves on a big
// transfer, so what the row shows has to include the parts that do.

import { describe, it, expect } from 'vitest';
import { transferTail } from '@/features/city/state/loading';

describe('transferTail', () => {
  it('shows the counts climbing under a percent that is not', () => {
    // Both from one real fetch, seconds apart: git said 9% for either.
    const early = transferTail({ percent: 9, objects: 39857, objectsTotal: 438084, mib: 597 });
    const later = transferTail({ percent: 9, objects: 40683, objectsTotal: 438084, mib: 873 });

    expect(early).toBe('9% · 39,857/438,084 · 597 MiB');
    expect(later).toBe('9% · 40,683/438,084 · 873 MiB');
    expect(early).not.toBe(later);
  });

  it('keeps whatever the line carried', () => {
    // Counting/resolving lines have no byte total, and some have no counts.
    expect(transferTail({ percent: 100, objects: 50, objectsTotal: 50 })).toBe('100% · 50/50');
    expect(transferTail({ percent: 12 })).toBe('12%');
  });

  it('says nothing when there is nothing to say', () => {
    expect(transferTail({})).toBeNull();
  });
});
