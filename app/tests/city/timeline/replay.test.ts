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
  expect(pt.createdIdx).toBe(0);
  expect(pt.deletedIdx).toBe(2);
  expect(linesAt(pt, 0)).toBe(2);
  expect(linesAt(pt, 0.5)).toBe(4);
  expect(linesAt(pt, 1)).toBe(6);
  expect(linesAt(pt, 2)).toBe(0);
  expect(presenceAt(pt, 1, 0)).toBe(1); // alive
  expect(presenceAt(pt, 2, 0)).toBe(0); // deleted, vanish (floor 0)
});

describe('buildPathTimelines', () => {
  test('a re-added path resurrects: clears deletedIdx, keeps original createdIdx', () => {
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
    expect(pt.createdIdx).toBe(0);
    expect(pt.deletedIdx).toBeNull();
    expect(linesAt(pt, 2)).toBe(6);
  });

  test('untouched paths before createdIdx are absent from the map key only if never seen', () => {
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
    expect(pt.createdIdx).toBe(1);
    expect(linesAt(pt, 3)).toBe(20);
  });

  test('returns 0 before createdIdx', () => {
    const pt = buildPathTimelines(bundle).get('f.txt')!;
    expect(linesAt(pt, -1)).toBe(0);
  });
});

describe('presenceAt', () => {
  test('ramps from 0 to 1 over the first 0.5 of a commit-index at creation', () => {
    const pt = buildPathTimelines(bundle).get('f.txt')!;
    expect(presenceAt(pt, 0, 0)).toBe(0);
    expect(presenceAt(pt, 0.25, 0)).toBeCloseTo(0.5);
    expect(presenceAt(pt, 0.5, 0)).toBe(1);
  });

  test('is 0 strictly before createdIdx and honors a non-zero ruinFloor after deletion', () => {
    const pt = buildPathTimelines(bundle).get('f.txt')!;
    expect(presenceAt(pt, -1, 0.2)).toBe(0);
    expect(presenceAt(pt, 2, 0.2)).toBe(0.2);
  });
});
