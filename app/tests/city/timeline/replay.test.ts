import { describe, test, expect } from 'vitest';
import { buildPathTimelines, linesAt, presenceAt } from '@/city/timeline/replay';
import type { TimelineBundle } from '@/types';

const bundle = {
  commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }],
  unionManifest: { tree: { name: 'r' } },
  deltas: [
    { sha: 'a', changes: [{ path: 'f.txt', sha: 's1' }] },
    { sha: 'b', changes: [{ path: 'f.txt', sha: 's2' }] },
    { sha: 'c', changes: [{ path: 'f.txt', sha: null }] },
  ],
  blobLines: { s1: 2, s2: 6 },
  note: null,
} as unknown as TimelineBundle;

test('per-path timeline: created, grows, deleted', () => {
  const pt = buildPathTimelines(bundle).get('f.txt')!;
  expect(pt.intervals).toEqual([{ start: 0, end: 2 }]);
  expect(linesAt(pt, 0)).toBe(2);
  expect(linesAt(pt, 0.5)).toBe(4);
  expect(linesAt(pt, 1)).toBe(6);
  expect(linesAt(pt, 2)).toBe(0);
  expect(presenceAt(pt, 1, 0)).toBe(1); // alive
  expect(presenceAt(pt, 2, 0)).toBe(0); // deleted, vanish (floor 0)
});

describe('buildPathTimelines', () => {
  test('a re-added path resurrects: closes the first interval, opens a second', () => {
    const resurrect = {
      commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }],
      unionManifest: { tree: { name: 'r' } },
      deltas: [
        { sha: 'a', changes: [{ path: 'f.txt', sha: 's1' }] },
        { sha: 'b', changes: [{ path: 'f.txt', sha: null }] },
        { sha: 'c', changes: [{ path: 'f.txt', sha: 's2' }] },
      ],
      blobLines: { s1: 2, s2: 6 },
      note: null,
    } as unknown as TimelineBundle;

    const pt = buildPathTimelines(resurrect).get('f.txt')!;
    expect(pt.intervals).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: null },
    ]);

    // dead-zone probe: absent for the whole gap between delete (i=1) and re-add (i=2)
    expect(linesAt(pt, 1)).toBe(0);
    expect(presenceAt(pt, 1, 0)).toBe(0);

    expect(linesAt(pt, 0)).toBe(2);
    expect(linesAt(pt, 2)).toBe(6);
    expect(presenceAt(pt, 2, 0)).toBe(1);
  });

  test('a path never seen is absent from the map', () => {
    const pt = buildPathTimelines(bundle).get('missing.txt');
    expect(pt).toBeUndefined();
  });
});

describe('linesAt', () => {
  test('holds the first value before the first change point, and the last value after', () => {
    const multi = {
      commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }, { sha: 'd' }],
      unionManifest: { tree: { name: 'r' } },
      deltas: [
        { sha: 'a', changes: [] },
        { sha: 'b', changes: [{ path: 'g.txt', sha: 's1' }] },
        { sha: 'c', changes: [{ path: 'g.txt', sha: 's2' }] },
        { sha: 'd', changes: [] },
      ],
      blobLines: { s1: 10, s2: 20 },
      note: null,
    } as unknown as TimelineBundle;

    const pt = buildPathTimelines(multi).get('g.txt')!;
    expect(pt.intervals).toEqual([{ start: 1, end: null }]);
    expect(linesAt(pt, 3)).toBe(20);
  });

  test('returns 0 before the path is created', () => {
    const pt = buildPathTimelines(bundle).get('f.txt')!;
    expect(linesAt(pt, -1)).toBe(0);
  });
});

describe('presenceAt', () => {
  test('a file is fully present at its creation commit (no genesis grow-in ramp)', () => {
    // A file exists in the snapshot at the commit it was created, so landing on
    // that commit must show it fully — not fade it in from 0. This holds at the
    // first commit (start 0), mid-history, and at HEAD (a rename records the moved
    // file as freshly created there).
    const first = buildPathTimelines(bundle).get('f.txt')!; // created at commit 0
    expect(first.intervals[0].start).toBe(0);
    expect(presenceAt(first, 0, 0)).toBe(1);

    const mid = {
      commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }],
      unionManifest: { tree: { name: 'r' } },
      deltas: [
        { sha: 'a', changes: [] },
        { sha: 'b', changes: [{ path: 'g.txt', sha: 's1' }] },
        { sha: 'c', changes: [] },
      ],
      blobLines: { s1: 6 },
      note: null,
    } as unknown as TimelineBundle;
    const pt = buildPathTimelines(mid).get('g.txt')!; // created at commit 1
    expect(pt.intervals[0].start).toBe(1);
    expect(presenceAt(pt, 1, 0)).toBe(1); // full at its creation commit
    expect(presenceAt(pt, 1.5, 0)).toBe(1);
    expect(presenceAt(pt, 0.9, 0)).toBe(0); // still absent just before creation
  });

  test('is 0 strictly before creation and honors a non-zero ruinFloor after deletion', () => {
    const pt = buildPathTimelines(bundle).get('f.txt')!;
    expect(presenceAt(pt, -1, 0.2)).toBe(0);
    expect(presenceAt(pt, 2, 0.2)).toBe(0.2);
  });

  test('honors a non-zero ruinFloor inside a resurrection gap', () => {
    const resurrect = {
      commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }],
      unionManifest: { tree: { name: 'r' } },
      deltas: [
        { sha: 'a', changes: [{ path: 'f.txt', sha: 's1' }] },
        { sha: 'b', changes: [{ path: 'f.txt', sha: null }] },
        { sha: 'c', changes: [{ path: 'f.txt', sha: 's2' }] },
      ],
      blobLines: { s1: 2, s2: 6 },
      note: null,
    } as unknown as TimelineBundle;

    const pt = buildPathTimelines(resurrect).get('f.txt')!;
    expect(presenceAt(pt, 1, 0.2)).toBe(0.2);
  });
});
