// scene/utils/path.ts — Pure helpers for the "path from gem to selection" line.
// Extracted from main.js so it can be tested in isolation. No DOM, no
// Three.js scene access — just data → data.
//
// Types are deliberately STRUCTURAL (only the fields these helpers
// actually read) so unit tests can pass minimal mock objects without
// having to construct a full Street / PickTarget. Real callers in the
// scene module pass full Street / PickTarget instances; structural
// compatibility makes that work without casts.

import { NodeKind, StreetAxis } from '@/types';

// parentDirPath(p) — return the parent directory path for a manifest path.
// Returns null for root ('.' / ''). Examples:
//   "src/scene/colors.js" → "src/scene"
//   "src"                 → "."
//   "."                   → null
export function parentDirPath(p: string | null | undefined): string | null {
  if (!p || p === '.' || p === '') return null;
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(0, idx) : '.';
}

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

// streetChainForDirPath(dirPath, streetsByDirPath) -> street[]
//
// Walk the parent chain from `dirPath` up to root, returning the chain in
// ROOT-FIRST order. `streetsByDirPath` is a map from directory path to its
// street object (each street has at minimum {x, y, length, width,
// orientation, dir}). Streets not present in the map are skipped silently.
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

// streetEndOpposite(street, awayFromX, awayFromZ) -> { x, z }
//
// The far end of `street`'s centerline — the cap-center coordinate
// FARTHER from (awayFromX, awayFromZ). Used to extend the path line
// across the selected street's full remaining length.
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

// computePathPoints(sel, gem, streetsByDirPath) -> [{x, z}]
//
// Returns the polyline points that trace from the gem along road
// centerlines to the selection. Adjacent points form individual segments
// that bend at street intersections.
//
// `sel` shape:
//   { kind: NodeKind.Directory, dir: { path } }
//   { kind: NodeKind.File,      file: { path }, data: { x, y, w, d } }
// `gem` shape: { x, z }
//
// Returns []if sel/gem missing or chain is empty.
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
  pts.push({ x: gem.x, z: gem.z });

  for (let i = 0; i < chain.length; i++) {
    const street = chain[i];
    if (i + 1 < chain.length) {
      // Bend at intersection with next street in chain.
      const next = chain[i + 1];
      if (street.orientation === StreetAxis.X) {
        pts.push({ x: next.x, z: street.y });
      } else {
        pts.push({ x: street.x, z: next.y });
      }
    } else if (sel.kind === NodeKind.Directory) {
      // Last leg: extend across the selected street's full remaining length.
      const prev = pts[pts.length - 1];
      pts.push(streetEndOpposite(street, prev.x, prev.z));
    } else if (sel.kind === NodeKind.File && sel.data) {
      // File selection: walk along the street to building's coordinate
      // along the road's long axis, THEN turn 90° to building's road-side
      // edge (NOT centroid — that would tunnel into the building).
      const b = sel.data;
      if (street.orientation === StreetAxis.X) {
        pts.push({ x: b.x, z: street.y });
        const edgeZ = b.y > street.y ? b.y - b.d / 2 : b.y + b.d / 2;
        pts.push({ x: b.x, z: edgeZ });
      } else {
        pts.push({ x: street.x, z: b.y });
        const edgeX = b.x > street.x ? b.x - b.w / 2 : b.x + b.w / 2;
        pts.push({ x: edgeX, z: b.y });
      }
    }
  }
  return pts;
}
