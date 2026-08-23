// city/layout/streetPath.ts — pure street-graph traversal for the gem →
// selection path line (data → data, no DOM or three). Types are STRUCTURAL
// on purpose: tests pass minimal mocks, real Streets/PickTargets satisfy
// them without casts.

import { NodeKind } from '@/types';
import { StreetAxis } from '@/city/scene/types';
import { parentDirPath } from '../utils/path';

/** Minimal street shape these helpers read. Real Streets satisfy this. */
interface StreetLike {
  x: number;
  y: number;
  length: number;
  width: number;
  orientation: StreetAxis;
}

/** Minimal selection shape these helpers read. Real PickTargets satisfy this. */
interface SelLike {
  kind: NodeKind;
  dir?: { path: string };
  file?: { path: string };
  data?: { x: number; y: number; w: number; d: number };
}

// Walk the parent chain up to root, ROOT-FIRST. Paths missing from the map
// are skipped silently.
export function streetChainForDirPath<S extends StreetLike>(
  dirPath: string | null,
  streetsByDirPath: Record<string, S>
): S[] {
  const chain: S[] = [];
  let p = dirPath;
  while (p != null) {
    const s = streetsByDirPath[p];
    if (s) chain.unshift(s);
    p = parentDirPath(p);
  }
  return chain;
}

// The cap-center FARTHER from the given point — extends the path line
// across the selected street's remaining length.
export function streetEndOpposite(
  street: StreetLike,
  awayFromX: number,
  awayFromZ: number
): { x: number; z: number } {
  const halfL = street.length / 2;
  const halfW = street.width / 2;
  if (street.orientation === StreetAxis.X) {
    const ea = street.x - halfL + halfW;
    const eb = street.x + halfL - halfW;
    const fx = Math.abs(awayFromX - ea) > Math.abs(awayFromX - eb) ? ea : eb;
    return { x: fx, z: street.y };
  } else {
    const ez1 = street.y - halfL + halfW;
    const ez2 = street.y + halfL - halfW;
    const fz = Math.abs(awayFromZ - ez1) > Math.abs(awayFromZ - ez2) ? ez1 : ez2;
    return { x: street.x, z: fz };
  }
}

// Polyline from the gem along road centerlines to the selection, bending at
// intersections. Empty when sel/gem are missing or the chain is empty.
export function computePathPoints(
  sel: SelLike | null | undefined,
  gem: { x: number; z: number } | null | undefined,
  streetsByDirPath: Record<string, StreetLike>
): Array<{ x: number; z: number }> {
  if (!sel || !gem) return [];
  let dirPath: string | null;
  if (sel.kind === NodeKind.Directory && sel.dir) {
    dirPath = sel.dir.path;
  } else if (sel.kind === NodeKind.File && sel.file) {
    dirPath = parentDirPath(sel.file.path);
  } else {
    return [];
  }
  if (dirPath == null) return [];

  const chain = streetChainForDirPath(dirPath, streetsByDirPath);
  if (chain.length === 0) return [];

  const pts: Array<{ x: number; z: number }> = [];
  // Coincident consecutive bends would feed the fat-lines shader a
  // zero-length segment (NaN on mobile; see city/utils/safeLineMaterial.ts).
  function push(x: number, z: number): void {
    const prev = pts[pts.length - 1];
    if (prev && prev.x === x && prev.z === z) return;
    pts.push({ x, z });
  }
  push(gem.x, gem.z);

  for (let i = 0; i < chain.length; i++) {
    const street = chain[i];
    if (i + 1 < chain.length) {
      // Bend at intersection with next street in chain.
      const next = chain[i + 1];
      if (street.orientation === StreetAxis.X) {
        push(next.x, street.y);
      } else {
        push(street.x, next.y);
      }
    } else if (sel.kind === NodeKind.Directory) {
      // Last leg: extend across the selected street's full remaining length.
      const prev = pts[pts.length - 1];
      const end = streetEndOpposite(street, prev.x, prev.z);
      push(end.x, end.z);
    } else if (sel.kind === NodeKind.File && sel.data) {
      // Walk the street to the building's long-axis coordinate, then turn
      // 90° to its road-side EDGE (a centroid would tunnel inside).
      const b = sel.data;
      if (street.orientation === StreetAxis.X) {
        push(b.x, street.y);
        const edgeZ = b.y > street.y ? b.y - b.d / 2 : b.y + b.d / 2;
        push(b.x, edgeZ);
      } else {
        push(street.x, b.y);
        const edgeX = b.x > street.x ? b.x - b.w / 2 : b.x + b.w / 2;
        push(edgeX, b.y);
      }
    }
  }
  return pts;
}
