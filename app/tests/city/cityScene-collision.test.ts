// world-collision.test.ts — _formatCollisionReport() partitions overlaps
import { WorldRectKind } from '@/city/layout/occupancyIndex';
// into unexpected vs. t-junction, produces an info-level summary when clean,
// and a warn-level summary + per-overlap detail block when dirty.

import { describe, it, expect } from 'vitest';
import { _formatCollisionReport } from '@/city/diagnostics';
import type { LayoutOverlap } from '@/city/layout/algorithm';

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
      category: 't-junction',
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
      category: 'unexpected',
    };
    const tj: LayoutOverlap = {
      kindA: WorldRectKind.Street,
      kindB: WorldRectKind.Street,
      labelA: 'a/',
      labelB: 'b/',
      rectA: { x: 0, y: 0, w: 10, d: 2 },
      rectB: { x: 5, y: 0, w: 2, d: 10 },
      overlap: { x: 5, y: 0, w: 2, d: 2 },
      category: 't-junction',
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
