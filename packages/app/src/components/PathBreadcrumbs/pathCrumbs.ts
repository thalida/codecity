// components/PathBreadcrumbs/pathCrumbs.ts — pure derivation of header breadcrumb segments from a
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

/** A path into clickable crumbs. The root has nothing to walk, so it collapses
 *  to one crumb carrying the repo label rather than a bare "." segment. */
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
