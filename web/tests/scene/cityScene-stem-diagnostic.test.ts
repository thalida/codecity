// cityScene-stem-diagnostic.test.ts — _formatStemDiagnostic groups child
// placements by parent road and emits a multi-line block per parent.

import { describe, it, expect } from 'vitest';
import { __test } from '@/scene/cityScene.js';
import type {
  StemPlacementTrace,
  ChildPlacementTrace,
  VariantTrace,
} from '@/scene/layout.js';

const { _formatStemDiagnostic } = __test;

function makeVariant(stem: number, side: 0 | 1 = 0, mirror = false): VariantTrace {
  return { side, mirror, stem, forbidden: [], bindingIndex: null };
}

function makePlacement(over: Partial<ChildPlacementTrace>): ChildPlacementTrace {
  return {
    childKind: 'file',
    childLabel: '?',
    childPath: '',
    parentPath: '.',
    baseline: 0,
    priorStem: 0,
    originPad: 0,
    chosen: makeVariant(0),
    others: [],
    ...over,
  };
}

describe('_formatStemDiagnostic', () => {
  it('empty trace — returns a single "no placements" line', () => {
    const trace: StemPlacementTrace = { placements: [] };
    const lines = _formatStemDiagnostic(trace);
    expect(lines).toEqual(['[stem-diag] no placements recorded']);
  });

  it('groups placements by parent road and prints one block per parent', () => {
    const trace: StemPlacementTrace = {
      placements: [
        makePlacement({ childLabel: 'a.ts', parentPath: '.', chosen: makeVariant(5), baseline: 5 }),
        makePlacement({ childLabel: 'b.ts', parentPath: '.', chosen: makeVariant(8), baseline: 8 }),
        makePlacement({
          childKind: 'dir', childLabel: 'sub', parentPath: '.',
          chosen: makeVariant(20), baseline: 11,
        }),
      ],
    };
    const lines = _formatStemDiagnostic(trace);
    const header = lines.find((l) => l.startsWith('[stem-diag] dir "."'));
    expect(header).toBeDefined();
    expect(header).toContain('3 children');
  });

  it('marks a jumped placement with "JUMPED" and the binding obstacle', () => {
    const obstacle = {
      minX: 11, minY: -1, maxX: 18, maxY: 1,
      kind: 'path' as const,
      ref: { file: { path: 'src/foo.ts', name: 'foo.ts' } } as never,
    };
    const trace: StemPlacementTrace = {
      placements: [
        makePlacement({
          childKind: 'dir', childLabel: 'sub', parentPath: '.',
          baseline: 5,
          chosen: {
            side: 0, mirror: false, stem: 19,
            forbidden: [
              { lower: 4, upper: 19, obstacle, fromChildRectIndex: 0 },
            ],
            bindingIndex: 0,
          },
        }),
      ],
    };
    const lines = _formatStemDiagnostic(trace);
    const flat = lines.join('\n');
    expect(flat).toContain('JUMPED');
    expect(flat).toContain('sub');
    expect(flat).toMatch(/path\b/);
    expect(flat).toContain('src/foo.ts');
  });

  it('clean placement (baseline === chosen.stem) does not say JUMPED', () => {
    const trace: StemPlacementTrace = {
      placements: [
        makePlacement({
          childLabel: 'a.ts', parentPath: '.',
          baseline: 5, chosen: makeVariant(5),
        }),
      ],
    };
    const lines = _formatStemDiagnostic(trace);
    expect(lines.join('\n')).not.toContain('JUMPED');
  });

  it('clean placement does not print "other variants tried" even when other variants exist', () => {
    const trace: StemPlacementTrace = {
      placements: [
        makePlacement({
          childLabel: 'a.ts', parentPath: '.',
          baseline: 5,
          chosen: makeVariant(5, 0, false),
          others: [makeVariant(5, 1, false)],
        }),
      ],
    };
    const lines = _formatStemDiagnostic(trace);
    expect(lines.join('\n')).not.toContain('other variants tried');
  });
});
