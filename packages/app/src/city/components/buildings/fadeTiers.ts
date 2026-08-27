// city/components/buildings/fadeTiers.ts — the one fade-tier decision, shared by
// the live fader and the timeline scrub controller, so a hover dims the city the
// same way whether or not you are time-travelling.
import type { BuildingsConfig } from '@codecity/city';
import { parentDirPath } from '@/city/utils/path';
import { ROOT_PATH } from '@codecity/city';
import { DirNode, FadeDetail, FileNode, NodeKind, Street } from '@codecity/city';
import { PickTarget } from '@/types/picker';

export interface TierResult {
  detail: FadeDetail;
  bodyOpacity: number;
  outlineEnabled: boolean;
  outlineOpacity: number;
}

// Symmetric tree distance: hops up to the common ancestor plus hops back down,
// so src/lib/ and src/foo/bar/ are equally near a selection in src/foo/.
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

// Where the cascade radiates from: the directory itself, or a file's parent.
// Hover beats selection, being the more immediate intent.
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

// The BUILDINGS store is flat: level N reads the LEVEL{N} prefix, everything
// else DEFAULT.
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
  // Checked first so the dirTreeDistance walk is skipped when the cursor is
  // already here. outlineRenderer owns the hover outline, so force it off.
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
