// How one building renders at a scrub position. No THREE and no meshes, so the
// decision table is exercisable without a scene; scrubApply.ts does the writes.

import { getBuildingDimensions } from '@/city/layout/dimensions';
import type { Building, FileNode } from '@/types';
import { FadeDetail } from '@/types';
import { isDataBuilding, isEmptyFile } from '@/utils/fileKind';
import type { PathTimeline } from '@/city/timeline/replay';
import {
  PathState,
  lastModifiedIndexAt,
  linesAt,
  presenceAt,
  ruinStateAt,
} from '@/city/timeline/replay';
import type { ColorTriple, ScrubFrame } from '@/city/timeline/scrubFrame';
import { recencyT } from '@/city/utils/recency';
import { BuildingKind } from './buildingKind';
import { getBuildingColorForRecency } from './color';
import { tierFor } from './fadeTiers';
import { parseDateMs } from '@/utils/dates';

/** PathState read through the ruin settings.
 *  Absent is still driven every frame, or a Live fade sweep lingers on it. */
export const BuildingLane = {
  Absent: 0,
  Present: 1,
  Ruin: 2,
} as const;
export type BuildingLane = (typeof BuildingLane)[keyof typeof BuildingLane];

// Neither has a date here, so both sample their own hue at mid-recency.
const RUIN_BASE_RECENCY = 0.5;
const RUIN_GRAY: ColorTriple = { r: 0.3, g: 0.31, b: 0.34 };

export interface BuildingScrubState {
  lane: BuildingLane;
  /** Lane opacity before the neighborhood fade. Footprint plots track this. */
  op: number;
  height: number;
  /** Window rows; a ruin blanks its facade. */
  floors: number;
  /** iFade.xyz. Only a present building owns the last two. */
  bodyOp: number;
  silhouette: number;
  outlineOp: number;
  /** The apply sets colorBase then lerps toward colorToward by colorMix. */
  colorBase: string;
  colorToward: ColorTriple | null;
  colorMix: number;
  kind: number;
  /** 0 = most recent, 1 = longest-untouched. */
  modifiedAge: number;
  /** 0 = newest, 1 = oldest. Drives both the age-lean and the grime. */
  createdAge: number;
}

/** The per-building facts the pass pairs up once, at construction. */
export interface BuildingScrubInput {
  b: Building;
  pt: PathTimeline;
  /** The commit index the path was created at (genesis, not resurrection). */
  createdIdx: number;
  /** The file's final (HEAD) modification. */
  finalIdx: number;
}

/** The pass keeps one per building: returning a fresh object would allocate
 *  tens of thousands of times a frame. */
export function blankBuildingScrubState(): BuildingScrubState {
  return {
    lane: BuildingLane.Absent,
    op: 0,
    height: 0,
    floors: 0,
    bodyOp: 0,
    silhouette: 0,
    outlineOp: 0,
    colorBase: '',
    colorToward: null,
    colorMix: 0,
    kind: BuildingKind.Normal,
    modifiedAge: 0,
    createdAge: 0,
  };
}

function laneAt(input: BuildingScrubInput, f: ScrubFrame): BuildingLane {
  const state = ruinStateAt(input.pt, f.pos);
  if (state === PathState.Present) return BuildingLane.Present;
  if (state === PathState.Ruin) return f.ruinsOn ? BuildingLane.Ruin : BuildingLane.Absent;
  return BuildingLane.Absent;
}

/** Past its final change the file's own date wins, so HEAD matches Live. */
function modifiedMsAt(input: BuildingScrubInput, pos: number, commitMs: readonly number[]): number {
  const lmIdx = lastModifiedIndexAt(input.pt, pos);
  if (lmIdx >= input.finalIdx) {
    const full = parseDateMs(input.b.file?.modified ?? '');
    if (!Number.isNaN(full)) return full;
  }
  return commitMs[lmIdx] ?? 0;
}

/** A fixed event, so the file's own date wins; genesis is the fallback. */
function createdMsFor(input: BuildingScrubInput, commitMs: readonly number[]): number {
  const full = parseDateMs(input.b.file?.created ?? '');
  return Number.isNaN(full) ? (commitMs[input.createdIdx] ?? 0) : full;
}

/** Recomputed every frame so a lane change resets it. */
function kindFor(file: FileNode, emptyFile: FileNode, lane: BuildingLane): number {
  if (lane === BuildingLane.Ruin) return BuildingKind.Ruin;
  if (isEmptyFile(emptyFile)) return BuildingKind.Empty;
  if (isDataBuilding(file)) return BuildingKind.Data;
  return BuildingKind.Normal;
}

export function resolveBuildingScrubState(
  input: BuildingScrubInput,
  f: ScrubFrame,
  commitMs: readonly number[],
  out: BuildingScrubState
): BuildingScrubState {
  const { b, pt } = input;
  const lane = laneAt(input, f);
  const present = lane === BuildingLane.Present;
  out.lane = lane;

  out.op = present
    ? presenceAt(pt, f.pos, 0)
    : lane === BuildingLane.Ruin
      ? f.ruinBuildingOpacity
      : 0;

  const createdMs = createdMsFor(input, commitMs);
  out.createdAge =
    present && f.createdSpread > 0
      ? 1 - Math.max(0, Math.min(1, (createdMs - f.minCreated) / f.createdSpread))
      : 0;

  // The union node's size is max-over-history, so only the replay knows what
  // this file measured HERE. Presence gates height, not lines: media is 0.
  const scrubFile = present ? ({ ...b.file, lines: linesAt(pt, f.pos) } as FileNode) : b.file;
  out.kind = kindFor(b.file, scrubFile, lane);

  if (present) {
    const dims = getBuildingDimensions(scrubFile, f.lineStats, f.byteStats);
    out.height = dims.h;
    out.floors = dims.floors;
  } else {
    // Stub or slab: the blank facade is what makes each read as what it is.
    out.height = lane === BuildingLane.Ruin ? f.ruinHeight : 0;
    out.floors = 0;
  }

  if (present) {
    // The tier buildingFader uses in Live, so a hover dims identically here.
    const tier = tierFor(b.file, f.bldgTargetFile, f.dirTarget, f.hoverFile, f.fadeCfg);
    out.bodyOp = tier.detail === FadeDetail.Hidden ? 0 : out.op * tier.bodyOpacity;
    out.silhouette = tier.detail === FadeDetail.Silhouette ? 1 : 0;
    out.outlineOp = tier.outlineEnabled ? tier.outlineOpacity : 0;

    // The same blended scale Live colours by, so HEAD matches.
    const recency = recencyT(
      modifiedMsAt(input, f.pos, commitMs),
      f.nowMs,
      f.fadeCfg.HALF_LIFE_DAYS
    );
    out.modifiedAge = 1 - recency;
    out.colorBase = getBuildingColorForRecency(b.file, recency);
    out.colorToward = null;
    out.colorMix = 0;
  } else {
    out.bodyOp = out.op;
    out.silhouette = 0;
    out.outlineOp = 0;
    out.modifiedAge = 0;
    if (lane === BuildingLane.Ruin) {
      // A ruin keeps a muted memory of the file's own hue.
      out.colorBase = getBuildingColorForRecency(b.file, RUIN_BASE_RECENCY);
      out.colorToward = RUIN_GRAY;
      out.colorMix = f.ruinGrayMix;
    } else {
      out.colorBase = '';
      out.colorToward = null;
      out.colorMix = 0;
    }
  }

  return out;
}
