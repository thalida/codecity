// Layout assertion helpers, formerly inlined in layout.test.ts.
// Moved here because layoutPacker.test.ts also needs them — and importing
// from a .test.ts file forces vitest to register the source file's
// describe() blocks twice across workers.
import { __test } from '@/scene/layout/layout.js';
import type { Rect } from '@/scene/layout/layout.js';
import { StreetAxis } from '@/types';
import type { CityLayout, Street, Building } from '@/types';

function _rectFromStreet(s: Street): Rect {
  if (s.orientation === StreetAxis.X) {
    return { x: s.x, y: s.y, w: s.length, d: s.width };
  }
  return { x: s.x, y: s.y, w: s.width, d: s.length };
}

function _rectFromBuilding(b: Building): Rect {
  return { x: b.x, y: b.y, w: b.w, d: b.d };
}

// True iff a and b strictly intersect; touching edges (zero overlap) returns false.
function _strictlyOverlaps(a: Rect, b: Rect): boolean {
  return __test._rectsOverlap(a, b);
}

// True iff `child` is the parent street of `parent` joining flat — i.e.
// one of these two rects is a child street whose joining end overlaps the
// parent street's body. We tolerate that overlap because the renderer
// flattens the join. Detection: one rect is a street perpendicular to the
// other, and one of its endpoints sits on the other's centerline within
// half a width.
function _isJoinPair(a: Street, b: Street): boolean {
  if (a.orientation === b.orientation) return false;
  // a perpendicular to b — check whether a's joining end touches b's centerline.
  const aLong = a.orientation === StreetAxis.X ? 'x' : 'y';
  const aCross = a.orientation === StreetAxis.X ? 'y' : 'x';
  const bLong = b.orientation === StreetAxis.X ? 'x' : 'y';
  const half = a.length / 2;
  const lowEnd = a[aLong] - half;
  const highEnd = a[aLong] + half;
  // For a perpendicular to b, b's centerline runs along bLong at b[aCross].
  // a's joining endpoint sits ON b's centerline (a constant value of bLong).
  const bCenterAlongA = b[aLong];
  // We assume one of (lowEnd, highEnd) is the join endpoint.
  const dLow = Math.abs(lowEnd - bCenterAlongA);
  const dHigh = Math.abs(highEnd - bCenterAlongA);
  // Likewise the other axis: the joining endpoint's perpendicular value
  // must be within b's half-length of b's center along b's long axis.
  // (i.e. the child's stem x must sit inside the parent's length span)
  const aPerpAtJoin = a[aCross];
  const bCenterPerp = b[bLong];
  // The +0.5 absorbs sub-unit floating-point drift from coordinate arithmetic;
  // the physical gap is zero at a well-formed join.
  const perpClose = Math.abs(aPerpAtJoin - bCenterPerp) <= b.length / 2 + 0.5;
  const longClose = Math.min(dLow, dHigh) <= b.width / 2 + 0.5;
  return perpClose && longClose;
}

export function assertNoOverlap(layout: CityLayout): void {
  type Tagged =
    | { rect: Rect; kind: 'street'; ref: Street }
    | { rect: Rect; kind: 'building'; ref: Building };
  const all: Tagged[] = [];
  for (const s of layout.streets) all.push({ rect: _rectFromStreet(s), kind: 'street', ref: s });
  for (const b of layout.buildings)
    all.push({ rect: _rectFromBuilding(b), kind: 'building', ref: b });

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const A = all[i],
        B = all[j];
      if (!_strictlyOverlaps(A.rect, B.rect)) continue;
      // Allowed exception: street-street join.
      if (A.kind === 'street' && B.kind === 'street' && _isJoinPair(A.ref, B.ref)) continue;
      throw new Error(
        `overlap between ${A.kind}@(${A.rect.x},${A.rect.y}) and ` +
          `${B.kind}@(${B.rect.x},${B.rect.y})`
      );
    }
  }
}

export function assertStemOrder(layout: CityLayout): void {
  // For each non-leaf street, find the children placed along it (subdir
  // streets with that street as parent + buildings whose orient points
  // toward that street). Sort by name; verify their stem-x along the
  // parent's long axis is monotonic.
  for (const parent of layout.streets) {
    const along = parent.orientation === StreetAxis.X ? 'x' : 'y';
    const cross = parent.orientation === StreetAxis.X ? 'y' : 'x';
    // Child subdir streets: perpendicular orientation, joining this parent.
    const childStreets = layout.streets.filter(
      (s) => s !== parent && s.orientation !== parent.orientation && _isJoinPair(s, parent)
    );
    // Child buildings: orient faces this parent. Building's own (x or y)
    // perpendicular distance to parent's centerline ≈ parent's halfWidth + path + halfDepth.
    const childBuildings = layout.buildings.filter((b) => {
      const perpDist = Math.abs(b[cross] - parent[cross]);
      const expected = parent.width / 2 + 0.5; // path/building offset varies; allow generous slop
      return perpDist > 0 && perpDist < expected + 50; // any building near this parent
    });
    type ChildSpec = { name: string; stemAlong: number };
    const specs: ChildSpec[] = [];
    for (const cs of childStreets) {
      specs.push({ name: cs.label || cs.dir?.name || '', stemAlong: cs[along] });
    }
    for (const cb of childBuildings) {
      specs.push({ name: cb.file?.name || '', stemAlong: cb[along] });
    }
    if (specs.length < 2) continue;
    // We can't reliably attribute every building to its true parent in
    // this heuristic walk — too many false positives for tests to be
    // useful in absolute terms. Instead, just verify that among CHILD
    // STREETS specifically (which we can disambiguate via _isJoinPair),
    // the alphabetical order matches the along-axis order.
    const streetSpecs = specs
      .filter((sp) =>
        layout.streets.some(
          (s) => s.orientation !== parent.orientation && (s.label || '') === sp.name
        )
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    // Determine direction by the first non-zero gap between consecutive
    // alphabetical siblings. The road may extend in +axis or -axis world
    // direction depending on whether parent subtree was negated; either is
    // valid as long as the order is monotonic in ONE direction throughout.
    let direction = 0; // -1 = descending, +1 = ascending, 0 = unknown
    for (let i = 1; i < streetSpecs.length; i++) {
      const delta = streetSpecs[i].stemAlong - streetSpecs[i - 1].stemAlong;
      if (delta === 0) continue; // ties allowed (paired stems)
      if (direction === 0) direction = delta > 0 ? 1 : -1;
      if ((direction > 0 && delta < 0) || (direction < 0 && delta > 0)) {
        throw new Error(
          `stem-x out of order along ${parent.label || parent.dir?.path}: ` +
            `${streetSpecs[i - 1].name}@${streetSpecs[i - 1].stemAlong} → ` +
            `${streetSpecs[i].name}@${streetSpecs[i].stemAlong}`
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
