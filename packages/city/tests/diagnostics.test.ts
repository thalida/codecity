import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  _formatCollisionReport,
  _formatStemDiagnostic,
  _formatTreeGroundingReport,
  auditTreeGrounding,
} from '../src/utils/diagnostics';
import { WorldRectKind } from '../src/layout/occupancyIndex';
import { LayoutOverlapCategory } from '../src/layout/overlaps';
import type { LayoutOverlap } from '../src/layout/overlaps';
import type {
  StemPlacementTrace,
  ChildPlacementTrace,
  VariantTrace,
} from '../src/layout/stemSolver';

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

// The audit reads the baked buffer, so these build the shape the renderer
// emits: canopy then trunk per tree, with the layout facts on userData.
describe('auditTreeGrounding', () => {
  const CANOPY_VERTS = 2;
  const TRUNK_VERTS = 3;

  /** One chunk holding `bases`, a trunk-base Y per tree. */
  function chunk(bases: number[]): THREE.Mesh {
    const perTree = CANOPY_VERTS + TRUNK_VERTS;
    const positions = new Float32Array(bases.length * perTree * 3);
    bases.forEach((baseY, slot) => {
      const at = (v: number, x: number, y: number, z: number) => {
        const o = (slot * perTree + v) * 3;
        positions[o] = x;
        positions[o + 1] = y;
        positions[o + 2] = z;
      };
      // Canopy sits well above the trunk; the audit must ignore it and measure
      // the trunk alone, or every tree reads as floating by its canopy height.
      at(0, slot, baseY + 50, slot);
      at(1, slot, baseY + 60, slot);
      // Trunk: lowest vertex is the base, the rest ride above it.
      at(CANOPY_VERTS, slot, baseY, slot);
      at(CANOPY_VERTS + 1, slot, baseY + 10, slot);
      at(CANOPY_VERTS + 2, slot, baseY + 5, slot);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mesh = new THREE.Mesh(geo);
    mesh.userData.meshKind = 'trees';
    mesh.userData.canopyVerts = CANOPY_VERTS;
    mesh.userData.trunkVerts = TRUNK_VERTS;
    mesh.userData.placementOrder = bases.map((_, i) => i);
    return mesh;
  }

  function groupOf(...meshes: THREE.Mesh[]): THREE.Group {
    const g = new THREE.Group();
    for (const m of meshes) g.add(m);
    return g;
  }

  it('passes trees whose trunks sit on the ground', () => {
    const report = auditTreeGrounding(groupOf(chunk([0, 0, 0])), 0);
    expect(report.checked).toBe(3);
    expect(report.offenders).toEqual([]);
  });

  it('catches a floating trunk and reports its gap', () => {
    const report = auditTreeGrounding(groupOf(chunk([0, 2, 0])), 0);
    expect(report.checked).toBe(3);
    expect(report.offenders).toHaveLength(1);
    expect(report.offenders[0].index).toBe(1);
    expect(report.offenders[0].gap).toBeCloseTo(2);
  });

  it('catches a sunk trunk too, and sorts the worst first', () => {
    const report = auditTreeGrounding(groupOf(chunk([-5, 2, 0])), 0);
    expect(report.offenders.map((o) => o.index)).toEqual([0, 1]);
    expect(report.offenders[0].gap).toBeCloseTo(-5);
  });

  // The whole point of the ISLAND_TOP_Y fix: trees baked at 0 over ground at -2.
  it('reports every tree when the ground plane itself is off', () => {
    const report = auditTreeGrounding(groupOf(chunk([0, 0, 0])), -2);
    expect(report.offenders).toHaveLength(3);
    expect(report.offenders[0].gap).toBeCloseTo(2);
  });

  it('walks every chunk, and ignores meshes that are not trees', () => {
    const foreign = chunk([9]);
    foreign.userData.meshKind = 'buildings';
    const report = auditTreeGrounding(groupOf(chunk([0]), chunk([3]), foreign), 0);
    expect(report.checked).toBe(2);
    expect(report.offenders).toHaveLength(1);
  });

  it('reports nothing to check when the forest is absent', () => {
    expect(auditTreeGrounding(null, 0).checked).toBe(0);
    expect(auditTreeGrounding(groupOf(), 0).checked).toBe(0);
  });
});

describe('_formatTreeGroundingReport', () => {
  it('states the all-clear with the plane it checked against', () => {
    const lines = _formatTreeGroundingReport({ checked: 812, groundY: 0, offenders: [] });
    expect(lines).toEqual(['[tree-ground] all 812 trees touch the ground (y=0)']);
  });

  it('names each offender with its gap and where to look', () => {
    const lines = _formatTreeGroundingReport({
      checked: 4,
      groundY: 0,
      offenders: [{ index: 7, x: 12.5, z: -3.25, baseY: 2, gap: 2 }],
    });
    expect(lines[0]).toContain('1 of 4 trees are off the ground');
    expect(lines[1]).toContain('tree #7');
    expect(lines[1]).toContain('(12.50, -3.25)');
    expect(lines[1]).toContain('floats 2.000');
  });

  it('caps the list so a systemic break prints a report, not a forest', () => {
    const offenders = Array.from({ length: 25 }, (_, i) => ({
      index: i,
      x: 0,
      z: 0,
      baseY: 2,
      gap: 2,
    }));
    const lines = _formatTreeGroundingReport({ checked: 25, groundY: 0, offenders });
    expect(lines).toHaveLength(1 + 20 + 1);
    expect(lines[lines.length - 1]).toBe('  ... and 5 more');
  });
});
