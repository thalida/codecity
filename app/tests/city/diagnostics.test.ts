import { describe, it, expect } from 'vitest';
import { _formatCollisionReport, _formatStemDiagnostic } from '@/city/diagnostics';
import { WorldRectKind } from '@/city/layout/occupancyIndex';
import { LayoutOverlapCategory } from '@/city/layout/overlaps';
import type { LayoutOverlap } from '@/city/layout/overlaps';
import type {
  StemPlacementTrace,
  ChildPlacementTrace,
  VariantTrace,
} from '@/city/layout/stemSolver';

describe('_formatCollisionReport', () => {
  it('clean case — 0 unexpected, 0 t-junctions', () => {
    const report = _formatCollisionReport([], 42);
    expect(report.level).toBe('info');
    expect(report.summary).toBe('[collision] 0 unexpected, 0 t-junctions whitelisted (42 rects)');
    expect(report.details).toEqual([]);
  });

  it('clean case — 0 unexpected, some t-junctions whitelisted', () => {
    const tj: LayoutOverlap = {
      kindA: WorldRectKind.Street,
      kindB: WorldRectKind.Street,
      labelA: 'a/',
      labelB: 'b/',
      rectA: { x: 0, y: 0, w: 10, d: 2 },
      rectB: { x: 5, y: 0, w: 2, d: 10 },
      overlap: { x: 5, y: 0, w: 2, d: 2 },
      category: LayoutOverlapCategory.TJunction,
    };
    const report = _formatCollisionReport([tj, tj, tj], 120);
    expect(report.level).toBe('info');
    expect(report.summary).toBe('[collision] 0 unexpected, 3 t-junctions whitelisted (120 rects)');
    expect(report.details).toEqual([]);
  });

  it('dirty case — emits warn level + one detail line per unexpected', () => {
    const u: LayoutOverlap = {
      kindA: WorldRectKind.Building,
      kindB: WorldRectKind.Street,
      labelA: 'src/foo.ts',
      labelB: 'src/',
      rectA: { x: 1.234, y: 2.345, w: 3.456, d: 4.567 },
      rectB: { x: 5.678, y: 6.789, w: 7.89, d: 8.901 },
      overlap: { x: 9.012, y: 10.123, w: 0.123, d: 0.456 },
      category: LayoutOverlapCategory.Unexpected,
    };
    const tj: LayoutOverlap = {
      kindA: WorldRectKind.Street,
      kindB: WorldRectKind.Street,
      labelA: 'a/',
      labelB: 'b/',
      rectA: { x: 0, y: 0, w: 10, d: 2 },
      rectB: { x: 5, y: 0, w: 2, d: 10 },
      overlap: { x: 5, y: 0, w: 2, d: 2 },
      category: LayoutOverlapCategory.TJunction,
    };
    const report = _formatCollisionReport([u, tj], 99);
    expect(report.level).toBe('warn');
    expect(report.summary).toBe('[collision] 1 unexpected, 1 t-junctions whitelisted (99 rects)');
    expect(report.details).toEqual([
      '  building "src/foo.ts" [x=1.23 y=2.35 w=3.46 d=4.57]\n' +
        '    ⟷ street "src/" [x=5.68 y=6.79 w=7.89 d=8.90]\n' +
        '    overlap=0.123×0.456 at (9.01, 10.12)',
    ]);
  });
});

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
          childKind: 'dir',
          childLabel: 'sub',
          parentPath: '.',
          chosen: makeVariant(20),
          baseline: 11,
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
      minX: 11,
      minY: -1,
      maxX: 18,
      maxY: 1,
      kind: WorldRectKind.Building,
      ref: { file: { path: 'src/foo.ts', name: 'foo.ts' } } as never,
    };
    const trace: StemPlacementTrace = {
      placements: [
        makePlacement({
          childKind: 'dir',
          childLabel: 'sub',
          parentPath: '.',
          baseline: 5,
          chosen: {
            side: 0,
            mirror: false,
            stem: 19,
            forbidden: [{ lower: 4, upper: 19, obstacle, fromChildRectIndex: 0 }],
            bindingIndex: 0,
          },
        }),
      ],
    };
    const lines = _formatStemDiagnostic(trace);
    const flat = lines.join('\n');
    expect(flat).toContain('JUMPED');
    expect(flat).toContain('sub');
    expect(flat).toContain('building');
    expect(flat).toContain('src/foo.ts');
  });

  it('clean placement (baseline === chosen.stem) does not say JUMPED', () => {
    const trace: StemPlacementTrace = {
      placements: [
        makePlacement({
          childLabel: 'a.ts',
          parentPath: '.',
          baseline: 5,
          chosen: makeVariant(5),
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
          childLabel: 'a.ts',
          parentPath: '.',
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
