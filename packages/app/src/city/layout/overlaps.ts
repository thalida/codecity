// city/layout/overlaps.ts — every rect-rect intersection in a finished layout,
// with T-junction joins classified apart from unexpected overlaps. Pure data;
// no DOM or Three.js.

import { rectOfBuilding, rectOfStreet, _rectsOverlap, rectEdges } from './rect';
import type { Rect } from './rect';
import { WorldRectKind } from './occupancyIndex';
import { Building, Street, StreetAxis } from '@codecity/city';

// Perpendicular streets whose endpoint sits on the other's centerline: the flat
// join the renderer fuses, and so the one overlap a layout may contain. The
// half-unit slop absorbs coordinate drift; a well-formed join has a zero gap.
export function isStreetJoinPair(a: Street, b: Street): boolean {
  if (a.orientation === b.orientation) return false;
  const aLong = a.orientation === StreetAxis.X ? 'x' : 'y';
  const aCross = a.orientation === StreetAxis.X ? 'y' : 'x';
  const bLong = b.orientation === StreetAxis.X ? 'x' : 'y';
  const half = a.length / 2;
  const lowEnd = a[aLong] - half;
  const highEnd = a[aLong] + half;
  const bCenterAlongA = b[aLong];
  const dLow = Math.abs(lowEnd - bCenterAlongA);
  const dHigh = Math.abs(highEnd - bCenterAlongA);
  const aPerpAtJoin = a[aCross];
  const bCenterPerp = b[bLong];
  const perpClose = Math.abs(aPerpAtJoin - bCenterPerp) <= b.length / 2 + 0.5;
  const longClose = Math.min(dLow, dHigh) <= b.width / 2 + 0.5;
  return perpClose && longClose;
}

// How an overlap is classified. String enum (values match the prior wire
// strings) so call sites reference LayoutOverlapCategory.TJunction, mirroring
// the WorldRectKind convention.
export enum LayoutOverlapCategory {
  TJunction = 't-junction',
  Unexpected = 'unexpected',
}

export interface LayoutOverlap {
  kindA: WorldRectKind;
  kindB: WorldRectKind;
  labelA: string;
  labelB: string;
  rectA: Rect;
  rectB: Rect;
  /** Intersection box. (x, y) is the intersection center; w/d are overlap dims. */
  overlap: Rect;
  category: LayoutOverlapCategory;
}

function _intersectRect(a: Rect, b: Rect): Rect {
  const A = rectEdges(a);
  const B = rectEdges(b);
  const ox1 = Math.max(A.x1, B.x1);
  const ox2 = Math.min(A.x2, B.x2);
  const oy1 = Math.max(A.y1, B.y1);
  const oy2 = Math.min(A.y2, B.y2);
  return { x: (ox1 + ox2) / 2, y: (oy1 + oy2) / 2, w: ox2 - ox1, d: oy2 - oy1 };
}

export function findLayoutOverlaps(layout: {
  streets: Street[];
  buildings: Building[];
}): LayoutOverlap[] {
  type Tagged =
    | { kind: WorldRectKind.Street; rect: Rect; label: string; ref: Street }
    | { kind: WorldRectKind.Building; rect: Rect; label: string; ref: Building };
  const all: Tagged[] = [];
  for (const s of layout.streets) {
    all.push({
      kind: WorldRectKind.Street,
      rect: rectOfStreet(s),
      label: s.dir?.path ?? s.label ?? '(root)',
      ref: s,
    });
  }
  for (const b of layout.buildings) {
    all.push({
      kind: WorldRectKind.Building,
      rect: rectOfBuilding(b),
      label: b.file?.path ?? b.file?.name ?? '?',
      ref: b,
    });
  }

  const out: LayoutOverlap[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const A = all[i],
        B = all[j];
      if (!_rectsOverlap(A.rect, B.rect)) continue;
      const overlap = _intersectRect(A.rect, B.rect);
      // Skip FP-noise overlaps. The internal _rectsOverlap uses
      // OVERLAP_EPS=1e-9, which is below the IEEE-754 drift produced by
      // chains of Float32 translations at large coordinate magnitudes
      // (~1e-5 at coords of 10000+). Touching-edge cases produce overlaps
      // with one dimension in that drift range; they're visually
      // imperceptible and not actual layout bugs.
      if (overlap.w < 1e-3 || overlap.d < 1e-3) continue;
      let category: LayoutOverlapCategory = LayoutOverlapCategory.Unexpected;
      if (
        A.kind === WorldRectKind.Street &&
        B.kind === WorldRectKind.Street &&
        isStreetJoinPair(A.ref, B.ref)
      ) {
        category = LayoutOverlapCategory.TJunction;
      }
      out.push({
        kindA: A.kind,
        kindB: B.kind,
        labelA: A.label,
        labelB: B.label,
        rectA: A.rect,
        rectB: B.rect,
        overlap,
        category,
      });
    }
  }
  return out;
}
