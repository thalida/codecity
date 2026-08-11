// The only per-frame reader of SCRUB_POS, the ruin/blueprint/building stores
// and the picker. Everything downstream takes a ScrubFrame value.

import * as THREE from 'three';

import { SCRUB_POS } from '@/state/stores/timeline';
import { BUILDING_DIMENSIONS, BUILDINGS } from '@/state/stores/settings/buildings';
import { RUINS } from '@/state/stores/settings/ruins';
import { BLUEPRINTS } from '@/state/stores/settings/blueprints';
import { NodeKind } from '@/types';
import type { FileNode, RangeStat, Street, TimelineBundle } from '@/types';
import { resolveDirTarget } from '@/city/components/buildings/fadeTiers';
import type { createPicker } from '@/city/interaction/picker';

/** A future building is drawn by the building mesh, not a footprint plot, so
 *  the blueprint look stays independent of the footprint controls. */
export const FUTURE_SLAB_FLOORS = 0.05;

export type CommitDateRange = NonNullable<TimelineBundle['commitDateRanges']>[number];

/** Already in THREE's working space: components rather than a CSS string keep
 *  the scrub decision free of THREE. */
export interface ColorTriple {
  r: number;
  g: number;
  b: number;
}

export interface ScrubFrame {
  pos: number;
  /** This commit's range, so height matches Live-at-that-commit. */
  lineStats: RangeStat;
  byteStats: RangeStat;
  ruinsOn: boolean;
  ruinBuildingOpacity: number;
  ruinHeight: number;
  ruinGrayMix: number;
  futureOn: boolean;
  futureBuildingOpacity: number;
  futureHeight: number;
  futureTint: number;
  futureColor: ColorTriple;
  minMod: number;
  minCreated: number;
  modSpread: number;
  createdSpread: number;
  bldgTargetFile: FileNode | null;
  dirTarget: ReturnType<typeof resolveDirTarget>;
  hoverFile: FileNode | null;
  fadeCfg: ReturnType<typeof BUILDINGS.peek>;
}

export interface ScrubFrameDeps {
  commitLineRanges: readonly RangeStat[];
  /** Replayed over the present set, so at HEAD weathering matches Live. */
  commitDateRanges: readonly CommitDateRange[];
  byteStats: RangeStat;
  streetsByDir: Record<string, Street>;
  picker: Pick<ReturnType<typeof createPicker>, 'selection' | 'hover'>;
}

const _futureColor = new THREE.Color();

export function readScrubFrame(deps: ScrubFrameDeps): ScrubFrame {
  const pos = SCRUB_POS.peek();

  // SCRUB_POS is clamped to the bundle; only the range arrays can fall short.
  const r = deps.commitLineRanges[Math.min(Math.floor(pos), deps.commitLineRanges.length - 1)];

  const floorHeight = BUILDING_DIMENSIONS.peek().FLOOR_HEIGHT;
  const ruins = RUINS.peek();
  const bp = BLUEPRINTS.peek();
  _futureColor.set(bp.BUILDING_COLOR);

  const dateRange =
    deps.commitDateRanges[Math.min(Math.floor(pos), deps.commitDateRanges.length - 1)];
  const minMod = dateRange?.minModified ?? 0;
  const minCreated = dateRange?.minCreated ?? 0;

  // The fader is dormant in Timeline, so resolve its targets here instead.
  const sel = deps.picker.selection.peek();
  const hov = deps.picker.hover.peek();

  return {
    pos,
    // Degenerate {0,0} → {1,1}: nothing downstream may divide by zero.
    lineStats: r && (r.min > 0 || r.max > 0) ? r : { min: 1, max: 1 },
    byteStats: deps.byteStats,
    ruinsOn: ruins.ENABLED,
    ruinBuildingOpacity: ruins.BUILDING_OPACITY,
    ruinHeight: ruins.STUB_HEIGHT * floorHeight,
    ruinGrayMix: ruins.DESATURATION,
    futureOn: bp.ENABLED,
    futureBuildingOpacity: bp.BUILDING_OPACITY,
    futureHeight: FUTURE_SLAB_FLOORS * floorHeight,
    futureTint: bp.BUILDING_TINT,
    futureColor: { r: _futureColor.r, g: _futureColor.g, b: _futureColor.b },
    minMod,
    minCreated,
    // Spread 0 (every present file shares a date) reads freshest, as in Live.
    modSpread: (dateRange?.maxModified ?? 0) - minMod,
    createdSpread: (dateRange?.maxCreated ?? 0) - minCreated,
    bldgTargetFile: sel?.kind === NodeKind.File ? sel.file : null,
    dirTarget: resolveDirTarget(sel, hov, deps.streetsByDir),
    hoverFile: hov?.kind === NodeKind.File ? hov.file : null,
    fadeCfg: BUILDINGS.peek(),
  };
}
