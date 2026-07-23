// city/components/buildings/fadeTiers.ts — the neighborhood fade-tier decision
// shared by the live buildingFader (fader.ts) and the timeline scrubController.
// Both own iFade in their respective modes (fader in Live, scrub controller
// while scrubbing), so routing both through tierFor() keeps ONE source of truth
// for the hover/selection cascade — a hover dims the surrounding city identically
// whether or not you're time-travelling.

import { NodeKind } from '@/types';
import type { BuildingsConfig } from '@/state/stores/settings/buildings';
import type { DirNode, FadeDetail, FileNode, PickTarget, Street } from '@/types';
import { parentDirPath } from '@/city/utils/path';
import { ROOT_PATH } from '@/constants/manifest';

export interface TierResult {
  detail: FadeDetail;
  bodyOpacity: number;
  outlineEnabled: boolean;
  outlineOpacity: number;
}

// Tier level for a building relative to the directory target, measured as the
// symmetric directory-tree distance: hops up to the lowest common ancestor plus
// hops back down. distance 0 = same dir (L1); 1 = one hop either direction (L2);
// 2 = two hops (L3); 3+ = far (L4). Going up matters the same as going down so a
// file in `src/lib/` and one in `src/foo/bar/` are equally "near" a selection in
// `src/foo/`.
function tierLevelFor(file: FileNode | null, dir: DirNode): 1 | 2 | 3 | 4 {
  if (!file?.path || !dir || dir.path == null) return 4;
  let parent = parentDirPath(file.path);
  if (parent == null) parent = ROOT_PATH;
  const ap = parent === ROOT_PATH ? [] : parent.split('/');
  const dp = dir.path === ROOT_PATH ? [] : dir.path.split('/');
  let lca = 0;
  while (lca < ap.length && lca < dp.length && ap[lca] === dp[lca]) lca++;
  const distance = ap.length - lca + (dp.length - lca);
  if (distance === 0) return 1;
  if (distance === 1) return 2;
  if (distance === 2) return 3;
  return 4;
}

// The directory the fade cascade radiates from: a selected/hovered directory
// directly, or the parent directory of a selected/hovered file (resolved via the
// street-by-dir map). Hover wins over selection — it's the more immediate intent.
export function resolveDirTarget(
  sel: PickTarget | null,
  hov: PickTarget | null,
  streetsByDir: Record<string, Street>
): DirNode | null {
  let dirTarget: DirNode | null = null;
  if (sel) {
    if (sel.kind === NodeKind.Directory) {
      dirTarget = sel.dir;
    } else if (sel.kind === NodeKind.File) {
      const pp = parentDirPath(sel.file.path);
      if (pp != null) {
        const ps = streetsByDir[pp];
        if (ps) dirTarget = ps.dir;
      }
    }
  }
  if (hov) {
    if (hov.kind === NodeKind.Directory && hov.street?.dir) {
      dirTarget = hov.street.dir;
    } else if (hov.kind === NodeKind.File && hov.file) {
      const hp = parentDirPath(hov.file.path);
      if (hp != null) {
        const hs = streetsByDir[hp];
        if (hs) dirTarget = hs.dir;
      }
    }
  }
  return dirTarget;
}

// Read one tier's four config values by key prefix. The BUILDINGS store is flat
// (DEFAULT_*, LEVEL1_*…LEVEL4_*); dir-tree level N maps to the LEVEL{N} prefix,
// every other tier to DEFAULT.
function tierFromPrefix(
  fadeCfg: BuildingsConfig,
  prefix: 'DEFAULT' | 'LEVEL1' | 'LEVEL2' | 'LEVEL3' | 'LEVEL4'
): TierResult {
  return {
    detail: fadeCfg[`${prefix}_DETAIL`],
    bodyOpacity: fadeCfg[`${prefix}_BODY_OPACITY`],
    outlineEnabled: fadeCfg[`${prefix}_OUTLINE`],
    outlineOpacity: fadeCfg[`${prefix}_OUTLINE_OPACITY`],
  };
}

// The full cascade decision for one building given the resolved targets.
export function tierFor(
  file: FileNode,
  bldgTargetFile: FileNode | null,
  dirTarget: DirNode | null,
  hoverFile: FileNode | null,
  fadeCfg: BuildingsConfig
): TierResult {
  // Hover wins — its tier values overwrite any selection/dir-tree result
  // unconditionally, so check first and skip the more expensive dirTreeDistance
  // walk when the cursor is already on this building. The hover outline is owned
  // by outlineRenderer, so force it off here.
  if (hoverFile && file.path === hoverFile.path) {
    return { ...tierFromPrefix(fadeCfg, 'DEFAULT'), outlineEnabled: false, outlineOpacity: 0 };
  }
  if (bldgTargetFile && file.path === bldgTargetFile.path) {
    return tierFromPrefix(fadeCfg, 'DEFAULT');
  }
  if (dirTarget) {
    const lvl = tierLevelFor(file, dirTarget);
    return tierFromPrefix(fadeCfg, `LEVEL${lvl}`);
  }
  return tierFromPrefix(fadeCfg, 'DEFAULT');
}
