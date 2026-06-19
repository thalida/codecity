// city/diagnostics.ts — the city's two console diagnostics (collision check +
// stem-placement trace), plus the pure formatters they route through. The
// runCollisionCheck / runStemPlacementDiagnostic entry points read the city's
// layout/manifest off cityState and print to the console; the City.world debug
// API delegates straight to them. The _format* helpers below read nothing but
// their arguments, so they unit-test in isolation.

import { layoutCityWithTrace } from './layout/algorithm';
import { findLayoutOverlaps } from './layout/overlaps';
import type { LayoutOverlap } from './layout/overlaps';
import type { ChildPlacementTrace, StemPlacementTrace } from './layout/stemSolver';
import type { WorldRect } from './layout/occupancyIndex';
import type { CityState } from './state';

// Run the layout-overlap check against the current layout and print the report.
// Unexpected overlaps warn (with per-overlap detail lines); a clean result logs
// an info summary. No-ops with a warning when no layout has been applied yet.
export function runCollisionCheck(cityState: CityState): void {
  const layout = cityState.layout.value;
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
export function runStemPlacementDiagnostic(cityState: CityState): void {
  const m = cityState.manifest.value;
  if (!m) {
    console.warn('[stem-diag] no manifest — apply one first');
    return;
  }
  const { trace } = layoutCityWithTrace(m as unknown as Parameters<typeof layoutCityWithTrace>[0]);
  for (const line of _formatStemDiagnostic(trace)) {
    console.log(line);
  }
}

// _formatCollisionReport(overlaps, totalRects) -> {level, summary, details}
//
// Pure helper. Partitions overlaps into unexpected vs. t-junction, returns the
// summary line and (for the dirty case) one detail string per unexpected
// overlap. Caller decides what to do with it — runCollisionCheck() routes to
// console.info / console.warn.
export function _formatCollisionReport(
  overlaps: LayoutOverlap[],
  totalRects: number
): { level: 'info' | 'warn'; summary: string; details: string[] } {
  const unexpected = overlaps.filter((o) => o.category === 'unexpected');
  const tjctCount = overlaps.filter((o) => o.category === 't-junction').length;
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

// _formatStemDiagnostic(trace) -> string[]
//
// Pure helper. Walks a StemPlacementTrace, groups placements by parent road,
// returns one or more lines per parent. Caller routes lines to console.log.
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
