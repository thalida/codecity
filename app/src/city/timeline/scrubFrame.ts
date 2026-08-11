// Everything the scrub pass reads once per frame, gathered in one place. This
// is the ONLY module that touches SCRUB_POS, the ruin/blueprint/building stores
// and the picker: downstream takes a ScrubFrame value, so nothing else has to
// drive global signals into position to reason about a scrub state.

import * as THREE from 'three';

import { SCRUB_POS } from '@/state/stores/timeline';
import { BUILDING_DIMENSIONS, BUILDINGS } from '@/state/stores/settings/buildings';
import { RUINS } from '@/state/stores/settings/ruins';
import { BLUEPRINTS } from '@/state/stores/settings/blueprints';
import { NodeKind } from '@/types';
import type { FileNode, RangeStat, Street, TimelineBundle } from '@/types';
import { resolveDirTarget } from '@/city/components/buildings/fadeTiers';
import type { createPicker } from '@/city/interaction/picker';

/** Future (not-yet-created) building: an ultra-low tinted slab via the building
 *  mesh (NOT footprint plots), so it's independent of the footprint controls. */
export const FUTURE_SLAB_FLOORS = 0.05;

export type CommitDateRange = NonNullable<TimelineBundle['commitDateRanges']>[number];

/** A colour in THREE's working space, already converted. Carrying components
 *  rather than a CSS string keeps the scrub decision free of THREE while still
 *  reproducing `new THREE.Color(r, g, b)` exactly on the apply side. */
export interface ColorTriple {
  r: number;
  g: number;
  b: number;
}

export interface ScrubFrame {
  pos: number;
  /** This commit's line range; height normalizes against it to match
   *  Live-at-that-commit rather than the union baseline. */
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
  /** Backend-replayed date ranges over the present set, indexed like
   *  commitLineRanges. At HEAD the present set == live, so weathering matches. */
  commitDateRanges: readonly CommitDateRange[];
  byteStats: RangeStat;
  streetsByDir: Record<string, Street>;
  picker: Pick<ReturnType<typeof createPicker>, 'selection' | 'hover'>;
}

const _futureColor = new THREE.Color();

export function readScrubFrame(deps: ScrubFrameDeps): ScrubFrame {
  const pos = SCRUB_POS.peek();

  // SCRUB_POS is already clamped to the loaded bundle, so only the upper end
  // needs guarding here: the range arrays can be shorter than the commit list.
  const r = deps.commitLineRanges[Math.min(Math.floor(pos), deps.commitLineRanges.length - 1)];

  const floorHeight = BUILDING_DIMENSIONS.peek().FLOOR_HEIGHT;
  const ruins = RUINS.peek();
  const bp = BLUEPRINTS.peek();
  _futureColor.set(bp.BUILDING_COLOR);

  const dateRange =
    deps.commitDateRanges[Math.min(Math.floor(pos), deps.commitDateRanges.length - 1)];
  const minMod = dateRange?.minModified ?? 0;
  const minCreated = dateRange?.minCreated ?? 0;

  // The SAME targets buildingFader resolves in Live, so a hover dims the city
  // identically while scrubbing (the fader is dormant in Timeline).
  const sel = deps.picker.selection.peek();
  const hov = deps.picker.hover.peek();

  return {
    pos,
    // Degenerate {0,0} → {1,1} so the renderer never divides by zero.
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
    // Spread 0 (all present files share a date) → freshest, matching Live.
    modSpread: (dateRange?.maxModified ?? 0) - minMod,
    createdSpread: (dateRange?.maxCreated ?? 0) - minCreated,
    bldgTargetFile: sel?.kind === NodeKind.File ? sel.file : null,
    dirTarget: resolveDirTarget(sel, hov, deps.streetsByDir),
    hoverFile: hov?.kind === NodeKind.File ? hov.file : null,
    fadeCfg: BUILDINGS.peek(),
  };
}
