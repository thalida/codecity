// The size edge cases that produced NaN geometry (#73). Invariant, not digest:
// a baseline captured from a broken run would enshrine the NaN.

import { describe, it, expect } from 'vitest';
import { layoutCity } from '../../src/layout/algorithm.js';
import {
  edgeCaseFiles,
  mkDir,
  mkFile,
  makeRng,
  statsFromTree,
} from '../_helpers/layoutTreeFixtures';
import { NodeKind } from '../../src/types/manifest';
import { layoutCfg } from '../_helpers/citySettings';

const CFG = layoutCfg();

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
    const layout = layoutCity({ tree, stats: statsFromTree(tree) }, CFG);

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
    const layout = layoutCity({ tree, stats: statsFromTree(tree) }, CFG);

    for (const s of layout.streets) {
      for (const f of ['x', 'y', 'length', 'width'] as const) {
        expect(Number.isFinite(s[f]), `street.${f} = ${s[f]}`).toBe(true);
      }
      expect(s.width).toBeGreaterThan(0);
    }
  });
});

// statsFromTree skips zero files like the server, so only a zero min reaches
// the >= 1 clamp — Math.log(0) would NaN every width downstream.
describe('layout dimensions given a zero-floored stats range', () => {
  const tree = () => mkDir('root', edgeCaseFiles('root'), 'root');

  it('survives a byte range starting at zero', () => {
    const layout = layoutCity(
      {
        tree: tree(),
        stats: {
          byteSizeRange: { min: 0, max: 51200 },
          lineCountRange: { min: 1, max: 400 },
        } as any,
      },
      CFG
    );

    expect(layout.buildings.length).toBeGreaterThan(0);
    for (const b of layout.buildings) {
      expect(Number.isFinite(b.w), `w = ${b.w}`).toBe(true);
      expect(b.w).toBeGreaterThan(0);
    }
  });

  it('survives a line range starting at zero', () => {
    const layout = layoutCity(
      {
        tree: tree(),
        stats: {
          byteSizeRange: { min: 1, max: 51200 },
          lineCountRange: { min: 0, max: 400 },
        } as any,
      },
      CFG
    );

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
    const layout = layoutCity({ tree, stats: statsFromTree(tree) }, CFG);

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
