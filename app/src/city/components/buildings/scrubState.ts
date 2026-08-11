// How one building renders at a scrub position. Pure: no THREE, no meshes, no
// signals beyond the shared palette/dimension helpers the live view also uses,
// so the whole decision table is exercisable without a scene.
//
// Everything here is a fact about a building, which is why it lives beside the
// buildings component rather than in city/timeline/ — the timeline pass decides
// WHEN, this decides WHAT, and scrubApply.ts turns it into buffer writes.

import { getBuildingDimensions } from '@/city/layout/dimensions';
import type { Building, FileNode } from '@/types';
import { FadeDetail } from '@/types';
import { isDataBuilding } from '@/utils/binaryKind';
import { isEmptyFile } from '@/utils/emptyKind';
import type { PathTimeline } from '@/city/timeline/replay';
import {
  PathState,
  entryAt,
  lastModifiedIndexAt,
  linesAt,
  presenceAt,
  ruinStateAt,
} from '@/city/timeline/replay';
import type { ColorTriple, ScrubFrame } from '@/city/timeline/scrubFrame';
import { BuildingKind } from './buildingKind';
import { getBuildingColorForRecency } from './color';
import { tierFor } from './fadeTiers';
import { getBuildingTiltAtAge } from './tilt';

/** How a building RENDERS at a scrub position: the history's PathState read
 *  through the ruin/blueprint settings, which is why there is a fourth value.
 *  Absent is a real lane, not an absence of one — it has to be driven to zero
 *  every frame so a Live-mode fade sweep can't leave it lingering. */
export const BuildingLane = {
  Absent: 0,
  Present: 1,
  Ruin: 2,
  Future: 3,
} as const;
export type BuildingLane = (typeof BuildingLane)[keyof typeof BuildingLane];

// A deleted building's ghost-ruin samples its file's hue at mid-recency before
// graying; a future slab does the same before tinting. Neither has a meaningful
// date at this position, so neither can sit on the recency curve.
const RUIN_BASE_RECENCY = 0.5;
const FUTURE_BASE_RECENCY = 0.5;
const RUIN_GRAY: ColorTriple = { r: 0.3, g: 0.31, b: 0.34 };

export interface BuildingScrubState {
  lane: BuildingLane;
  /** Lane opacity before the neighborhood fade: 1 present, the ruin/future
   *  setting for those, 0 absent. The footprint plot tracks this, not bodyOp. */
  op: number;
  /** World height. Absent is 0, but the apply zero-scales all three axes rather
   *  than laying a (w, 0, d) quad that would still write depth and outline. */
  height: number;
  /** Window rows. A ruin and a future slab both blank their facade. */
  floors: number;
  tiltX: number;
  tiltZ: number;
  /** iFade.xyz. Present buildings own all three so a hover still shows; the
   *  other lanes carry a faint body and nothing else. */
  bodyOp: number;
  silhouette: number;
  outlineOp: number;
  /** Colour as base-plus-pull, so the decision stays free of THREE: the apply
   *  sets colorBase (a CSS string) then lerps toward colorToward by colorMix.
   *  An absent building keeps a blank base and is never recoloured. */
  colorBase: string;
  colorToward: ColorTriple | null;
  colorMix: number;
  kind: number;
  /** 0 = most recent, 1 = longest-untouched. Only meaningful when present. */
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

/** A blank state to resolve into. The pass keeps one per building for the life
 *  of the controller: this resolves once per building per frame, so returning a
 *  fresh object would allocate tens of thousands of times a frame. */
export function blankBuildingScrubState(): BuildingScrubState {
  return {
    lane: BuildingLane.Absent,
    op: 0,
    height: 0,
    floors: 0,
    tiltX: 0,
    tiltZ: 0,
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
  // A deleted file is never a blueprint: it did exist, it just doesn't now.
  if (state === PathState.Ruin) return f.ruinsOn ? BuildingLane.Ruin : BuildingLane.Absent;
  // Genesis is ahead: an ultra-low tinted slab at its eventual footprint.
  if (f.futureOn && input.createdIdx > f.pos) return BuildingLane.Future;
  return BuildingLane.Absent;
}

/** Scrub-relative modified ms: full-precision own date once past its final
 *  change (HEAD weathering 1:1 with Live), else the day-precise commit date. */
function modifiedMsAt(input: BuildingScrubInput, pos: number, commitMs: readonly number[]): number {
  const lmIdx = lastModifiedIndexAt(input.pt, pos);
  if (lmIdx >= input.finalIdx) {
    const full = Date.parse(input.b.file?.modified ?? '');
    if (!Number.isNaN(full)) return full;
  }
  return commitMs[lmIdx] ?? 0;
}

/** Creation is a fixed event: prefer the file's full-precision created date
 *  (matches Live's createdAge), fall back to its genesis commit date. */
function createdMsFor(input: BuildingScrubInput, commitMs: readonly number[]): number {
  const full = Date.parse(input.b.file?.created ?? '');
  return Number.isNaN(full) ? (commitMs[input.createdIdx] ?? 0) : full;
}

/** iKind is recomputed every frame so a lane change resets it: Ruin/Future,
 *  else Empty (no content here), else Data (binary), else Normal. */
function kindFor(file: FileNode, emptyFile: FileNode, lane: BuildingLane): number {
  if (lane === BuildingLane.Ruin) return BuildingKind.Ruin;
  if (lane === BuildingLane.Future) return BuildingKind.Future;
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
      : lane === BuildingLane.Future
        ? f.futureBuildingOpacity
        : 0;

  // createdAge is scrub-relative and feeds both the lean shear and the grime.
  const createdMs = createdMsFor(input, commitMs);
  out.createdAge =
    present && f.createdSpread > 0
      ? 1 - Math.max(0, Math.min(1, (createdMs - f.minCreated) / f.createdSpread))
      : 0;

  // Emptiness is a fact about the blob in effect, not a point on a curve:
  // between a 0-line commit and a later big one, a lerp reads non-empty.
  const emptyFile = present
    ? ({ ...b.file, lines: entryAt(pt, f.pos)?.lines ?? 0 } as FileNode)
    : b.file;
  out.kind = kindFor(b.file, emptyFile, lane);

  if (present) {
    // Gate height on presence (intervals), not line count: media/empty files are
    // present with 0 lines. Width stays layout-baked (b.w), so dims.w is unused.
    // The union node's size is max-over-history, so only the replay knows what
    // this file measured HERE.
    const scrubFile = { ...b.file, lines: linesAt(pt, f.pos) } as FileNode;
    const dims = getBuildingDimensions(scrubFile, f.lineStats, f.byteStats);
    out.height = dims.h;
    out.floors = dims.floors;
    const tilt = getBuildingTiltAtAge(b.file.path, out.createdAge);
    out.tiltX = tilt.tiltX;
    out.tiltZ = tilt.tiltZ;
  } else {
    // A ruin is a uniform low stub and a future building an ultra-low slab; both
    // read as rubble/blueprint precisely because their facades are blank.
    out.height =
      lane === BuildingLane.Ruin ? f.ruinHeight : lane === BuildingLane.Future ? f.futureHeight : 0;
    out.floors = 0;
    out.tiltX = 0;
    out.tiltZ = 0;
  }

  if (present) {
    // The SAME tier decision buildingFader uses in Live, so a hover dims the
    // city identically while scrubbing (op is 1 when present, so op *
    // tier.bodyOpacity is the Live absolute).
    const tier = tierFor(b.file, f.bldgTargetFile, f.dirTarget, f.hoverFile, f.fadeCfg);
    out.bodyOp = tier.detail === FadeDetail.Hidden ? 0 : out.op * tier.bodyOpacity;
    out.silhouette = tier.detail === FadeDetail.Silhouette ? 1 : 0;
    out.outlineOp = tier.outlineEnabled ? tier.outlineOpacity : 0;

    // recency = modified-date t (0 = oldest, 1 = newest) → the colour curve.
    const modMs = modifiedMsAt(input, f.pos, commitMs);
    const recency =
      f.modSpread > 0 ? Math.max(0, Math.min(1, (modMs - f.minMod) / f.modSpread)) : 1;
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
      // A ghost ruin keeps a muted memory of its file's hue, pulled toward gray.
      out.colorBase = getBuildingColorForRecency(b.file, RUIN_BASE_RECENCY);
      out.colorToward = RUIN_GRAY;
      out.colorMix = f.ruinGrayMix;
    } else if (lane === BuildingLane.Future) {
      // A future slab keeps its file's own hue, pulled toward the future colour.
      out.colorBase = getBuildingColorForRecency(b.file, FUTURE_BASE_RECENCY);
      out.colorToward = f.futureColor;
      out.colorMix = f.futureTint;
    } else {
      out.colorBase = '';
      out.colorToward = null;
      out.colorMix = 0;
    }
  }

  return out;
}
