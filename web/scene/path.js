// path.js — Pure helpers for the "path from gem to selection" line.
// Extracted from main.js so it can be tested in isolation. No DOM, no
// Three.js scene access — just data → data.

// parentDirPath(p) — return the parent directory path for a manifest path.
// Returns null for root ('.' / ''). Examples:
//   "src/scene/colors.js" → "src/scene"
//   "src"                 → "."
//   "."                   → null
export function parentDirPath(p) {
  if (!p || p === '.' || p === '') return null;
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(0, idx) : '.';
}

// streetChainForDirPath(dirPath, streetsByDirPath) -> street[]
//
// Walk the parent chain from `dirPath` up to root, returning the chain in
// ROOT-FIRST order. `streetsByDirPath` is a map from directory path to its
// street object (each street has at minimum {x, y, length, width,
// orientation, dir}). Streets not present in the map are skipped silently.
export function streetChainForDirPath(dirPath, streetsByDirPath) {
  const chain = [];
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
export function streetEndOpposite(street, awayFromX, awayFromZ) {
  const halfL = street.length / 2;
  const halfW = street.width / 2;
  if (street.orientation === 'x') {
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
//   { kind: 'directory', dir: { path } }
//   { kind: 'file',      file: { path }, data: { x, y, w, d } }
// `gem` shape: { x, z }
//
// Returns []if sel/gem missing or chain is empty.
export function computePathPoints(sel, gem, streetsByDirPath) {
  if (!sel || !gem) return [];
  const dirPath = sel.kind === 'directory' ? sel.dir.path : parentDirPath(sel.file.path);
  if (dirPath == null) return [];

  const chain = streetChainForDirPath(dirPath, streetsByDirPath);
  if (chain.length === 0) return [];

  const pts = [];
  pts.push({ x: gem.x, z: gem.z });

  for (let i = 0; i < chain.length; i++) {
    const street = chain[i];
    if (i + 1 < chain.length) {
      // Bend at intersection with next street in chain.
      const next = chain[i + 1];
      if (street.orientation === 'x') {
        pts.push({ x: next.x, z: street.y });
      } else {
        pts.push({ x: street.x, z: next.y });
      }
    } else if (sel.kind === 'directory') {
      // Last leg: extend across the selected street's full remaining length.
      const prev = pts[pts.length - 1];
      pts.push(streetEndOpposite(street, prev.x, prev.z));
    } else {
      // File selection: walk along the street to building's coordinate
      // along the road's long axis, THEN turn 90° to building's road-side
      // edge (NOT centroid — that would tunnel into the building).
      const b = sel.data;
      if (street.orientation === 'x') {
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
