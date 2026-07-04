// utils/pathCrumbs.ts — pure derivation of header breadcrumb segments from a
// selected path. Kept out of the component so it's unit-testable.

export interface PathCrumb {
  /** Text shown on the crumb button. */
  label: string;
  /** Path this crumb re-selects when clicked (relative to the repo root). */
  segPath: string;
}

export interface PathCrumbs {
  /** True when the selection is the repo root — rendered as one repo-label crumb. */
  isRoot: boolean;
  crumbs: PathCrumb[];
}

/**
 * Split a selected path into clickable breadcrumb segments. The repo root (a
 * directory whose path is the root path) has no relative path to walk, so it
 * collapses to a single crumb carrying the repo label instead of a bare "."
 * segment. Every other path splits on "/", each crumb's `segPath` being the
 * path up to and including that segment.
 */
export function buildPathCrumbs(
  path: string,
  opts: { isDir?: boolean; rootLabel: string; rootPath: string }
): PathCrumbs {
  const { isDir, rootLabel, rootPath } = opts;
  const isRoot = !!isDir && path === rootPath;
  const crumbs: PathCrumb[] = isRoot
    ? [{ label: rootLabel, segPath: rootPath }]
    : path
        .split('/')
        .filter(Boolean)
        .map((seg, i, all) => ({ label: seg, segPath: all.slice(0, i + 1).join('/') }));
  return { isRoot, crumbs };
}
