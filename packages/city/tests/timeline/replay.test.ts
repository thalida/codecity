import { describe, test, expect } from 'vitest';
import {
  buildPathTimelines,
  linesAt,
  blobShaAt,
  entryAt,
  presenceAt,
  statsAtDeletion,
} from '../../src/timeline/replay';
import type { TimelineBundle } from '../../src/types/timeline';

const bundle = {
  commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }],
  unionManifest: { tree: { name: 'r' } },
  deltas: [
    { sha: 'a', changes: [{ path: 'f.txt', sha: 's1' }] },
    { sha: 'b', changes: [{ path: 'f.txt', sha: 's2' }] },
    { sha: 'c', changes: [{ path: 'f.txt', sha: null }] },
  ],
  blobLines: { s1: 2, s2: 6 },
  blobSizes: { s1: 40, s2: 120 },
  note: null,
} as unknown as TimelineBundle;

test('per-path timeline: created, grows, deleted', () => {
  const pt = buildPathTimelines(bundle).get('f.txt')!;
  expect(pt.intervals).toEqual([{ start: 0, end: 2 }]);
  expect(linesAt(pt, 0)).toBe(2);
  // Between two commits the file measures what its last change left it at: it
  // does not creep toward an edit that hasn't happened.
  expect(linesAt(pt, 0.5)).toBe(2);
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
      blobSizes: { s1: 0, s2: 0 },
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
      blobSizes: { s1: 0, s2: 0 },
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
    // A file is in the snapshot at the commit that created it, so landing there
    // must show it whole. True at the first commit, mid-history and at HEAD.
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
      blobSizes: { s1: 0 },
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
      blobSizes: { s1: 0, s2: 0 },
      note: null,
    } as unknown as TimelineBundle;

    const pt = buildPathTimelines(resurrect).get('f.txt')!;
    expect(presenceAt(pt, 1, 0.2)).toBe(0.2);
  });
});

describe('statsAtDeletion', () => {
  test('reports the last live values, not the zeroes the deletion entry records', () => {
    const pt = buildPathTimelines(bundle).get('f.txt')!;
    expect(statsAtDeletion(pt, 2)).toEqual({ lines: 6, bytes: 120 });
  });

  test('is null while the path is still alive', () => {
    const pt = buildPathTimelines(bundle).get('f.txt')!;
    expect(statsAtDeletion(pt, 0)).toBeNull();
    expect(statsAtDeletion(pt, 1)).toBeNull();
  });

  test('a resurrected path reports the latest death, not the first', () => {
    const resurrect = {
      commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }, { sha: 'd' }],
      unionManifest: { tree: { name: 'r' } },
      deltas: [
        { sha: 'a', changes: [{ path: 'f.txt', sha: 's1' }] },
        { sha: 'b', changes: [{ path: 'f.txt', sha: null }] },
        { sha: 'c', changes: [{ path: 'f.txt', sha: 's2' }] },
        { sha: 'd', changes: [{ path: 'f.txt', sha: null }] },
      ],
      blobLines: { s1: 2, s2: 6 },
      blobSizes: { s1: 40, s2: 120 },
      note: null,
    } as unknown as TimelineBundle;

    const pt = buildPathTimelines(resurrect).get('f.txt')!;
    expect(statsAtDeletion(pt, 1)).toEqual({ lines: 2, bytes: 40 });
    expect(statsAtDeletion(pt, 2)).toBeNull(); // alive again
    expect(statsAtDeletion(pt, 3)).toEqual({ lines: 6, bytes: 120 });
  });
});

describe('entryAt', () => {
  test('steps: an unchanged commit still reports the entry in effect', () => {
    const pt = buildPathTimelines(bundle).get('f.txt')!;
    // changes at 0 and 1, so 0.5 sits between them: the entry does NOT move.
    expect(entryAt(pt, 0)?.lines).toBe(2);
    expect(entryAt(pt, 0.5)?.lines).toBe(2);
    expect(entryAt(pt, 1)?.lines).toBe(6);
    // linesAt reads through it, so a height can't disagree with the blob it
    // was drawn from.
    expect(linesAt(pt, 0.5)).toBe(entryAt(pt, 0.5)?.lines);
  });

  test('is null once the path is gone', () => {
    const pt = buildPathTimelines(bundle).get('f.txt')!;
    expect(entryAt(pt, 2)).toBeNull();
  });
});

describe('blobShaAt', () => {
  test('names the blob in effect at a position, not the newest one', () => {
    const pt = buildPathTimelines(bundle).get('f.txt')!;
    expect(blobShaAt(pt, 0)).toBe('s1');
    expect(blobShaAt(pt, 1)).toBe('s2');
    // Held between changes, so a mid-scrub position still resolves.
    expect(blobShaAt(pt, 1.5)).toBe('s2');
  });

  test('is null once the path is gone, so nothing is fetched for it', () => {
    const pt = buildPathTimelines(bundle).get('f.txt')!;
    expect(blobShaAt(pt, 2)).toBeNull();
  });
});
