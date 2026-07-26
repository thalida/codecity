// The file-size edge cases that produced NaN building geometry (#73).
// Asserts the invariant rather than a digest: a baseline captured from a broken
// run would enshrine the NaN as expected.

import { describe, it, expect } from 'vitest';
import { layoutCity } from '@/city/layout/algorithm.js';
import { NodeKind } from '@/types';
import {
  edgeCaseFiles,
  mkDir,
  mkFile,
  makeRng,
  statsFromTree,
} from '../../_helpers/layoutTreeFixtures';

const NUMERIC_FIELDS = ['x', 'y', 'w', 'd', 'h', 'floors'] as const;
const POSITIVE_FIELDS = ['w', 'd', 'h'] as const;

function edgeTree(): any {
  return mkDir('root', edgeCaseFiles('root'), 'root');
}

// Edge files beside ordinary ones: alone they make every range degenerate, which
// can mask a bug that only appears when a real min/max spread exists.
function mixedTree(): any {
  const rng = makeRng(0xed6e);
  const normal = Array.from({ length: 12 }, (_, i) => mkFile(`f${i}.c`, 'root', rng));
  return mkDir('root', [...edgeCaseFiles('root'), ...normal], 'root');
}

describe.each([
  ['edge files only', edgeTree],
  ['edge files mixed with ordinary ones', mixedTree],
])('layout dimensions with %s', (_label, build) => {
  it('emits a building per file with finite, positive dimensions', () => {
    const tree = build();
    const layout = layoutCity({ tree, stats: statsFromTree(tree) });

    const fileCount = tree.children.filter((c: any) => c.type === NodeKind.File).length;
    expect(layout.buildings).toHaveLength(fileCount);

    for (const b of layout.buildings) {
      for (const f of NUMERIC_FIELDS) {
        expect(Number.isFinite(b[f]), `building.${f} = ${b[f]}`).toBe(true);
      }
      for (const f of POSITIVE_FIELDS) {
        expect(b[f], `building.${f}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps streets finite too, since they size off the same ranges', () => {
    const tree = build();
    const layout = layoutCity({ tree, stats: statsFromTree(tree) });

    for (const s of layout.streets) {
      for (const f of ['x', 'y', 'length', 'width'] as const) {
        expect(Number.isFinite(s[f]), `street.${f} = ${s[f]}`).toBe(true);
      }
      expect(s.width).toBeGreaterThan(0);
    }
  });
});

// statsFromTree builds ranges from non-zero files only, like the server does,
// so edge files alone never reach the >= 1 clamp. A zero min does: it puts
// Math.log(0) into the normalization, and every width downstream goes NaN.
describe('layout dimensions given a zero-floored stats range', () => {
  const tree = () => mkDir('root', edgeCaseFiles('root'), 'root');

  it('survives a byte range starting at zero', () => {
    const layout = layoutCity({
      tree: tree(),
      stats: {
        byteSizeRange: { min: 0, max: 51200 },
        lineCountRange: { min: 1, max: 400 },
      } as any,
    });

    expect(layout.buildings.length).toBeGreaterThan(0);
    for (const b of layout.buildings) {
      expect(Number.isFinite(b.w), `w = ${b.w}`).toBe(true);
      expect(b.w).toBeGreaterThan(0);
    }
  });

  it('survives a line range starting at zero', () => {
    const layout = layoutCity({
      tree: tree(),
      stats: {
        byteSizeRange: { min: 1, max: 51200 },
        lineCountRange: { min: 0, max: 400 },
      } as any,
    });

    for (const b of layout.buildings) {
      expect(Number.isFinite(b.h), `h = ${b.h}`).toBe(true);
      expect(Number.isFinite(b.floors), `floors = ${b.floors}`).toBe(true);
      expect(b.h).toBeGreaterThan(0);
    }
  });
});

// statsFromTree skips zero values when building its ranges, so an all-empty repo
// hands the layout a 0..0 range — the degenerate case behind Math.log(0).
describe('layout dimensions when every file is empty', () => {
  it('still produces finite, positive buildings', () => {
    const tree = mkDir(
      'root',
      [0, 1, 2].map((i) => ({
        name: `e${i}.txt`,
        type: NodeKind.File,
        path: `root/e${i}.txt`,
        extension: '.txt',
        size: 0,
        lines: 0,
      })),
      'root'
    );
    const layout = layoutCity({ tree, stats: statsFromTree(tree) });

    expect(layout.buildings).toHaveLength(3);
    for (const b of layout.buildings) {
      for (const f of NUMERIC_FIELDS) {
        expect(Number.isFinite(b[f]), `${f} = ${b[f]}`).toBe(true);
      }
      for (const f of POSITIVE_FIELDS) {
        expect(b[f], String(f)).toBeGreaterThan(0);
      }
    }
  });
});
