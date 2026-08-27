// Built on the production overlap diagnostic so the tests and the live
// collision check cannot disagree about what counts as an overlap.
import {
  findLayoutOverlaps,
  isStreetJoinPair,
  LayoutOverlapCategory,
} from '@/city/layout/overlaps';
import { CityLayout, Street, StreetAxis } from '@codecity/city';

export function assertNoOverlap(layout: CityLayout): void {
  const bad = findLayoutOverlaps(layout).filter(
    (o) => o.category === LayoutOverlapCategory.Unexpected
  );
  if (bad.length === 0) return;
  const [first] = bad;
  const more = bad.length > 1 ? ` (+${bad.length - 1} more)` : '';
  throw new Error(
    `overlap between ${first.kindA} ${first.labelA}@(${first.rectA.x},${first.rectA.y}) ` +
      `and ${first.kindB} ${first.labelB}@(${first.rectB.x},${first.rectB.y})${more}`
  );
}

// Streets only: a building cannot be attributed to its parent road by geometry
// alone, so including them yields false positives.
export function assertStemOrder(layout: CityLayout): void {
  for (const parent of layout.streets) {
    const along = parent.orientation === StreetAxis.X ? 'x' : 'y';
    const children = layout.streets
      .filter(
        (s) => s !== parent && s.orientation !== parent.orientation && isStreetJoinPair(s, parent)
      )
      .map((s) => ({ name: s.label || s.dir?.name || '', stemAlong: s[along] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (children.length < 2) continue;

    // A negated subtree runs its road in the -axis direction, so either
    // direction passes as long as it holds for the whole run. Ties are paired
    // stems, two children placed opposite each other.
    let direction = 0;
    for (let i = 1; i < children.length; i++) {
      const delta = children[i].stemAlong - children[i - 1].stemAlong;
      if (delta === 0) continue;
      if (direction === 0) direction = delta > 0 ? 1 : -1;
      if (direction * delta < 0) {
        throw new Error(
          `stem-x out of order along ${parent.label || parent.dir?.path}: ` +
            `${children[i - 1].name}@${children[i - 1].stemAlong} → ` +
            `${children[i].name}@${children[i].stemAlong}`
        );
      }
    }
  }
}

// Verifies each non-root street has a parent street whose dir is the tree
// parent of this street's dir. (T-junction geometry is checked separately by
// assertTJunctionsValid.)
export function assertTreeRespecting(layout: CityLayout): void {
  // Build a map from dir.path to its street.
  const byPath: Record<string, Street> = {};
  for (const s of layout.streets) {
    if (s.dir && s.dir.path != null) byPath[s.dir.path] = s;
  }

  for (const s of layout.streets) {
    if (s.isRoot) continue;
    if (!s.dir || s.dir.path == null) continue;
    const parts = s.dir.path.split('/');
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    const parent = byPath[parentPath];
    if (!parent) {
      throw new Error(`street ${s.dir.path}: tree parent path ${parentPath} has no street`);
    }
  }
}

// Verifies each non-root street's joining end (the end closer to its parent's
// centerline) sits ON the parent's centerline within tolerance, AND the join
// happens within the parent's length span.
export function assertTJunctionsValid(layout: CityLayout): void {
  const byPath: Record<string, Street> = {};
  for (const s of layout.streets) {
    if (s.dir && s.dir.path != null) byPath[s.dir.path] = s;
  }

  for (const s of layout.streets) {
    if (s.isRoot) continue;
    if (!s.dir || s.dir.path == null) continue;
    const parts = s.dir.path.split('/');
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    const parent = byPath[parentPath];
    if (!parent) continue; // tree-respecting test already caught this

    // Perpendicular streets only join validly via T-junction.
    if (s.orientation === parent.orientation) {
      throw new Error(`street ${s.dir.path} has same orientation as parent ${parentPath}`);
    }

    // The joining endpoint sits on the parent's centerline (constant value of
    // the parent's perp axis).
    const TOLERANCE = 0.5; // generous, FP drift can accumulate
    const sAlongAxis = s.orientation === StreetAxis.X ? 'x' : 'y';
    const halfL = s.length / 2;
    const lowEnd = s[sAlongAxis] - halfL;
    const highEnd = s[sAlongAxis] + halfL;
    const parentCenterline = parent[sAlongAxis];
    const dLow = Math.abs(lowEnd - parentCenterline);
    const dHigh = Math.abs(highEnd - parentCenterline);
    const minDist = Math.min(dLow, dHigh);
    if (minDist > TOLERANCE) {
      throw new Error(
        `street ${s.dir.path}: nearest endpoint is ${minDist.toFixed(2)} from ` +
          `parent ${parentPath}'s centerline (>${TOLERANCE})`
      );
    }

    // The joining point sits within the parent's length span.
    const sCrossAxis = s.orientation === StreetAxis.X ? 'y' : 'x';
    const parentAlongAxis = parent.orientation === StreetAxis.X ? 'x' : 'y';
    const sPerpAtJoin = s[sCrossAxis];
    const parentLow = parent[parentAlongAxis] - parent.length / 2;
    const parentHigh = parent[parentAlongAxis] + parent.length / 2;
    if (sPerpAtJoin < parentLow - TOLERANCE || sPerpAtJoin > parentHigh + TOLERANCE) {
      throw new Error(
        `street ${s.dir.path}: join point (${sPerpAtJoin.toFixed(2)}) outside ` +
          `parent ${parentPath} length span [${parentLow.toFixed(2)}, ${parentHigh.toFixed(2)}]`
      );
    }
  }
}
