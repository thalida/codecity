// city/diagnostics.ts — the console diagnostics and the formatters they print
// through. The entry points read cityState; the formatters read nothing but
// their arguments, so they test in isolation.

import * as THREE from 'three';
import { layoutCityWithTrace } from '../layout/algorithm';
import { findLayoutOverlaps, LayoutOverlapCategory } from '../layout/overlaps';
import type { LayoutOverlap } from '../layout/overlaps';
import type { ChildPlacementTrace, StemPlacementTrace } from '../layout/stemSolver';
import type { WorldRect } from '../layout/occupancyIndex';
import type { CityState } from '../state';
import type { LayoutConfig } from '../layout/config';

// Unexpected overlaps warn with a line each; a clean run logs a summary.
export function runCollisionCheck(cityState: CityState): void {
  const layout = cityState.layout;
  if (!layout) {
    console.warn('[collision] no layout — apply a manifest first');
    return;
  }
  const overlaps = findLayoutOverlaps(layout);
  const totalRects = layout.streets.length + layout.buildings.length;
  const report = _formatCollisionReport(overlaps, totalRects);
  if (report.level === 'info') {
    console.info(report.summary);
  } else {
    console.warn(report.summary);
    for (const line of report.details) {
      console.warn(line);
    }
  }
}

// Re-run layout with tracing on the current manifest and print the stem-
// placement trace. No-ops with a warning when no manifest has been applied yet.
export function runStemPlacementDiagnostic(cityState: CityState, cfg: LayoutConfig): void {
  const m = cityState.manifest;
  if (!m) {
    console.warn('[stem-diag] no manifest — apply one first');
    return;
  }
  const { trace } = layoutCityWithTrace(
    m as unknown as Parameters<typeof layoutCityWithTrace>[0],
    cfg
  );
  for (const line of _formatStemDiagnostic(trace)) {
    console.log(line);
  }
}

/** One tree whose trunk doesn't reach the ground, in world units. */
export interface TreeGroundingOffender {
  /** Placement index, matching the renderer's per-chunk placementOrder. */
  index: number;
  x: number;
  z: number;
  /** Lowest trunk vertex, straight off the baked buffer. */
  baseY: number;
  /** Signed distance from the ground: positive floats, negative sinks. */
  gap: number;
}

export interface TreeGroundingReport {
  checked: number;
  groundY: number;
  offenders: TreeGroundingOffender[];
}

// A trunk's base and the island's top cap are both authored at exact values, so
// anything past a hair is a real gap rather than float drift.
const GROUNDING_EPSILON = 1e-3;

/** Every tree's lowest trunk vertex against the ground, read from the baked
 *  buffers: recomputing the maths would only ever confirm itself. */
export function auditTreeGrounding(
  group: THREE.Object3D | null,
  groundY: number
): TreeGroundingReport {
  const offenders: TreeGroundingOffender[] = [];
  let checked = 0;
  if (!group) return { checked, groundY, offenders };

  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    const ud = mesh.userData ?? {};
    if (ud.meshKind !== 'trees') continue;
    const canopyVerts = ud.canopyVerts as number | undefined;
    const trunkVerts = ud.trunkVerts as number | undefined;
    const order = ud.placementOrder as number[] | undefined;
    const pos = mesh.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos || !order || canopyVerts == null || trunkVerts == null) continue;

    const perTree = canopyVerts + trunkVerts;
    for (let slot = 0; slot < order.length; slot++) {
      const trunkStart = slot * perTree + canopyVerts;
      let baseY = Infinity;
      let sumX = 0;
      let sumZ = 0;
      for (let v = trunkStart; v < trunkStart + trunkVerts; v++) {
        baseY = Math.min(baseY, pos.getY(v));
        sumX += pos.getX(v);
        sumZ += pos.getZ(v);
      }
      checked++;
      const gap = baseY - groundY;
      if (Math.abs(gap) > GROUNDING_EPSILON) {
        offenders.push({
          index: order[slot],
          x: sumX / trunkVerts,
          z: sumZ / trunkVerts,
          baseY,
          gap,
        });
      }
    }
  }
  // Worst first: the biggest gap is the one to look at in the scene.
  offenders.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  return { checked, groundY, offenders };
}

/** Audit every tree's contact with the ground and print the report. */
export function runTreeGroundingDiagnostic(group: THREE.Object3D | null, groundY: number): void {
  const report = auditTreeGrounding(group, groundY);
  if (report.checked === 0) {
    console.warn('[tree-ground] no trees to check — is the Trees layer on?');
    return;
  }
  const lines = _formatTreeGroundingReport(report);
  const log = report.offenders.length === 0 ? console.info : console.warn;
  for (const line of lines) log(line);
}

// A summary, then the offenders worst-first, capped so a systemic break
// doesn't print a line per tree in the forest.
export function _formatTreeGroundingReport(report: TreeGroundingReport): string[] {
  const { checked, groundY, offenders } = report;
  if (offenders.length === 0) {
    return [`[tree-ground] all ${checked} trees touch the ground (y=${groundY})`];
  }
  const MAX_LINES = 20;
  const out = [
    `[tree-ground] ${offenders.length} of ${checked} trees are off the ground ` +
      `(y=${groundY}); worst ${Math.min(offenders.length, MAX_LINES)} below`,
  ];
  for (const o of offenders.slice(0, MAX_LINES)) {
    const verb = o.gap > 0 ? 'floats' : 'sinks';
    out.push(
      `  tree #${o.index} at (${o.x.toFixed(2)}, ${o.z.toFixed(2)}) ` +
        `${verb} ${Math.abs(o.gap).toFixed(3)} (base y=${o.baseY.toFixed(3)})`
    );
  }
  if (offenders.length > MAX_LINES) {
    out.push(`  ... and ${offenders.length - MAX_LINES} more`);
  }
  return out;
}

// Splits unexpected overlaps from t-junctions and returns lines; the caller
// decides which console channel they go to.
export function _formatCollisionReport(
  overlaps: LayoutOverlap[],
  totalRects: number
): { level: 'info' | 'warn'; summary: string; details: string[] } {
  const unexpected = overlaps.filter((o) => o.category === LayoutOverlapCategory.Unexpected);
  const tjctCount = overlaps.filter((o) => o.category === LayoutOverlapCategory.TJunction).length;
  const summary =
    `[collision] ${unexpected.length} unexpected, ${tjctCount} t-junctions ` +
    `whitelisted (${totalRects} rects)`;
  if (unexpected.length === 0) {
    return { level: 'info', summary, details: [] };
  }
  const fmtRect = (r: { x: number; y: number; w: number; d: number }): string =>
    `[x=${r.x.toFixed(2)} y=${r.y.toFixed(2)} w=${r.w.toFixed(2)} d=${r.d.toFixed(2)}]`;
  const details = unexpected.map(
    (o) =>
      `  ${o.kindA} "${o.labelA}" ${fmtRect(o.rectA)}\n` +
      `    ⟷ ${o.kindB} "${o.labelB}" ${fmtRect(o.rectB)}\n` +
      `    overlap=${o.overlap.w.toFixed(3)}×${o.overlap.d.toFixed(3)} ` +
      `at (${o.overlap.x.toFixed(2)}, ${o.overlap.y.toFixed(2)})`
  );
  return { level: 'warn', summary, details };
}

// Groups placements by parent road, one or more lines each.
export function _formatStemDiagnostic(trace: StemPlacementTrace): string[] {
  if (trace.placements.length === 0) {
    return ['[stem-diag] no placements recorded'];
  }

  // Group by parent path, preserving first-seen order.
  const byParent = new Map<string, ChildPlacementTrace[]>();
  for (const p of trace.placements) {
    let bucket = byParent.get(p.parentPath);
    if (!bucket) {
      bucket = [];
      byParent.set(p.parentPath, bucket);
    }
    bucket.push(p);
  }

  const out: string[] = [];
  for (const [parentPath, children] of byParent) {
    out.push(`[stem-diag] dir "${parentPath}" — ${children.length} children`);
    for (const c of children) {
      // Match display precision: jumps below half a toFixed(2) unit display
      // as +0.00 and would be misleading.
      const jumped = c.chosen.stem - c.baseline > 0.005;
      const tag = c.childKind === 'dir' ? `"${c.childLabel}/"` : `"${c.childLabel}"`;
      const jumpedNote = jumped ? `  ← JUMPED +${(c.chosen.stem - c.baseline).toFixed(2)}` : '';
      out.push(
        `  ─ ${tag} (${c.childKind}) — stem=${c.chosen.stem.toFixed(2)}  ` +
          `(baseline=${c.baseline.toFixed(2)})${jumpedNote}`
      );
      if (jumped && c.chosen.bindingIndex !== null) {
        const binding = c.chosen.forbidden[c.chosen.bindingIndex];
        const obs = binding.obstacle;
        const label = _obstacleLabel(obs);
        out.push(
          `     forced by: ${obs.kind} ${label}  ` +
            `y=[${_yBounds(obs).join(', ')}] x=[${_xBounds(obs).join(', ')}]`
        );
      }
      if (jumped && c.others.length > 0) {
        out.push(`     other variants tried:`);
        const all = [c.chosen, ...c.others].sort(
          (a, b) => a.side - b.side || Number(a.mirror) - Number(b.mirror)
        );
        for (const v of all) {
          const marker = v === c.chosen ? '(chosen)' : '';
          out.push(
            `       side=${v.side} mirror=${v.mirror} → stem=${v.stem.toFixed(2)} ${marker}`.trimEnd()
          );
        }
      }
    }
  }
  return out;
}

function _obstacleLabel(o: WorldRect): string {
  // WorldRect.ref is loosely typed (Building | Street); try common
  // shapes without forcing tight coupling.
  const r = o.ref as {
    file?: { path?: string; name?: string };
    label?: string;
    dir?: { path?: string };
  };
  return (r.file && (r.file.path ?? r.file.name)) ?? r.label ?? (r.dir && r.dir.path) ?? '?';
}

function _yBounds(o: WorldRect): [string, string] {
  return [o.minY.toFixed(2), o.maxY.toFixed(2)];
}

function _xBounds(o: WorldRect): [string, string] {
  return [o.minX.toFixed(2), o.maxX.toFixed(2)];
}
