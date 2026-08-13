// The only per-frame reader of SCRUB_POS, the ruin/building stores
// and the picker. Everything downstream takes a ScrubFrame value.

import { SCRUB_POS } from '@/state/stores/timeline';
import { BUILDING_DIMENSIONS, BUILDINGS } from '@/state/stores/settings/buildings';
import { RUINS } from '@/state/stores/settings/ruins';
import { NodeKind } from '@/types';
import type { FileNode, RangeStat, Street, TimelineBundle } from '@/types';
import { resolveDirTarget } from '@/city/components/buildings/fadeTiers';
import type { createPicker } from '@/city/interaction/picker';

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
   *  scan date at HEAD, where the city is the working tree just as Live is. */
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
  /** The scan date, which is "now" at HEAD. */
  scannedAtMs: number;
  byteStats: RangeStat;
  streetsByDir: Record<string, Street>;
  picker: Pick<ReturnType<typeof createPicker>, 'selection' | 'hover'>;
}

/** At HEAD the city IS the working tree, so "now" is the scan date and colour
 *  matches Live. Earlier, it is the date the handle sits on: the commit you're
 *  standing on, plus however far you've dragged toward the next one.
 *
 *  Interpolated rather than snapped to the commit, so a long quiet stretch
 *  actually reads as time passing. Held at the commit, nothing aged until the
 *  next one arrived and then everything aged at once. The handle's date is what
 *  the timeline bar prints, so the city and the readout agree.
 *
 *  Not measured past the commit you're standing on: a repo scrubbed to its
 *  first commit would paint brand-new files as ancient against a date that
 *  hasn't happened there yet. */
function scrubNow(pos: number, deps: ScrubFrameDeps): number {
  const last = deps.commitMs.length - 1;
  const i = Math.floor(pos);
  if (i >= last) return deps.scannedAtMs;
  const from = deps.commitMs[i] ?? deps.scannedAtMs;
  const to = deps.commitMs[i + 1] ?? deps.scannedAtMs;
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
