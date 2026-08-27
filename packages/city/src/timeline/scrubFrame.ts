// The only per-frame reader of SCRUB_POS, the ruin/building stores
// and the picker. Everything downstream takes a ScrubFrame value.

import { SCRUB_POS } from '@/state/stores/timeline';
import { BUILDING_DIMENSIONS, BUILDINGS } from '@/state/settings/fields/buildings';
import { RUINS } from '@/state/settings/fields/ruins';
import { resolveDirTarget } from '@/city/components/buildings/fadeTiers';
import type { createPicker } from '@/city/interaction/picker';
import { FileNode, NodeKind, RangeStat } from '@/city/types/manifest';
import { Street } from '@/city/types/street';
import { TimelineBundle } from '@/city/types/timeline';

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
  /** What "now" means at this position: the commit under the scrubber, or the
   *  end of the track once past the last one. */
  nowMs: number;
  minCreated: number;
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
  /** Commit dates as ms, for resolving what "now" is mid-scrub. */
  commitMs: readonly number[];
  /** What the far end of the track means. The bar's last stop is the same
   *  moment, so the city and the readout end on one date. */
  trackEndMs: number;
  byteStats: RangeStat;
  streetsByDir: Record<string, Street>;
  picker: Pick<ReturnType<typeof createPicker>, 'selection' | 'hover'>;
}

/** The date the handle sits on, interpolated toward the next commit so a quiet
 *  stretch reads as time passing, and on past the last one to today. */
function scrubNow(pos: number, deps: ScrubFrameDeps): number {
  const i = Math.floor(pos);
  const from = deps.commitMs[i] ?? deps.trackEndMs;
  const to = deps.commitMs[i + 1] ?? deps.trackEndMs;
  return from + (to - from) * (pos - i);
}

export function readScrubFrame(deps: ScrubFrameDeps): ScrubFrame {
  const pos = SCRUB_POS.peek();

  // SCRUB_POS is clamped to the bundle; only the range arrays can fall short.
  const r = deps.commitLineRanges[Math.min(Math.floor(pos), deps.commitLineRanges.length - 1)];

  const floorHeight = BUILDING_DIMENSIONS.peek().FLOOR_HEIGHT;
  const ruins = RUINS.peek();

  const dateRange =
    deps.commitDateRanges[Math.min(Math.floor(pos), deps.commitDateRanges.length - 1)];
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
    nowMs: scrubNow(pos, deps),
    minCreated,
    createdSpread: (dateRange?.maxCreated ?? 0) - minCreated,
    bldgTargetFile: sel?.kind === NodeKind.File ? sel.file : null,
    dirTarget: resolveDirTarget(sel, hov, deps.streetsByDir),
    hoverFile: hov?.kind === NodeKind.File ? hov.file : null,
    fadeCfg: BUILDINGS.peek(),
  };
}
