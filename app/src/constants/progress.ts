// constants/progress.ts — the vocabulary of one load, at two grains: the rows
// the overlay advances through, and the sub-stages that run inside its last row
// once the stream has handed over to the build.

import { ScanPhase } from '@/api/manifest';
import { SourceKind } from '@/utils/sources';
import { TimelineStage, type Manifest } from '@/types';

// ── The overlay's rows ───────────────────────────────────────────────

export enum LoadingStep {
  Resolving = 'resolving',
  Cloning = 'cloning',
  Scanning = 'scanning',
  Skeleton = 'skeleton',
  /** The server walking git log, once the heights have landed: the longest
   *  stage of a cold scan, and the one the city's trees come out of. */
  History = 'history',
  Building = 'building',
  // Timeline-mode entry, one row per stage of the history stream: the blob
  // backfill, the commit walk, then blob resolution.
  TimelineFetch = 'timeline-fetch',
  TimelineHistory = 'timeline-history',
  TimelineBlobs = 'timeline-blobs',
}

// Display order. 'history' is the git walk after the heights, and 'building'
// raises the final city, trees and all, so it ends every list.
export const LOADING_STEPS: readonly LoadingStep[] = [
  LoadingStep.Resolving,
  LoadingStep.Cloning,
  LoadingStep.Scanning,
  LoadingStep.Skeleton,
  LoadingStep.History,
  LoadingStep.Building,
];

// A rebuild with no stream behind it: a remount packs the manifest already in
// hand, so every fetch row above would be a row for work nobody did.
export const BUILD_ONLY_STEPS: readonly LoadingStep[] = [LoadingStep.Building];

// Timeline's own list. Reuses LoadingStep.Building rather than inventing
// a second label for the same act.
export const TIMELINE_LOADING_STEPS: readonly LoadingStep[] = [
  LoadingStep.TimelineFetch,
  LoadingStep.TimelineHistory,
  LoadingStep.TimelineBlobs,
  LoadingStep.Building,
];

// Where a row sits relative to the active step. The values are the
// `data-state` attribute the overlay renders and the CSS styles.
export enum LoadingStepState {
  Pending = 'pending',
  Active = 'active',
  Done = 'done',
}

// Human-readable label for each step.
export const LOADING_STEP_LABELS: Record<LoadingStep, string> = {
  [LoadingStep.Resolving]: 'Resolving source',
  [LoadingStep.Cloning]: 'Cloning',
  [LoadingStep.Scanning]: 'Scanning files',
  [LoadingStep.Skeleton]: 'Sketching layout',
  [LoadingStep.History]: 'Reading history',
  [LoadingStep.Building]: 'Building city',
  [LoadingStep.TimelineFetch]: 'Fetching history',
  [LoadingStep.TimelineHistory]: 'Walking commits',
  [LoadingStep.TimelineBlobs]: 'Resolving files',
};

// Steps that exist only for a remote source: a path already on disk has
// nothing to resolve, clone, or fetch.
const REMOTE_ONLY_STEPS: ReadonlySet<LoadingStep> = new Set([
  LoadingStep.Resolving,
  LoadingStep.Cloning,
  LoadingStep.TimelineFetch,
]);

/** Git's transfer as the rows show it. It sits on one percent for minutes of a
 *  big fetch, so the counts beside it are what say the transfer is alive. */
export function transferTail(p: {
  percent?: number;
  objects?: number;
  objectsTotal?: number;
  mib?: number;
}): string | null {
  // != null, not !== undefined: these cross the wire, where the type is a
  // promise rather than a guarantee.
  const parts: string[] = [];
  if (p.percent != null) parts.push(`${p.percent}%`);
  if (p.objects != null && p.objectsTotal != null) {
    parts.push(`${p.objects.toLocaleString()}/${p.objectsTotal.toLocaleString()}`);
  }
  if (p.mib != null) parts.push(`${p.mib.toLocaleString()} MiB`);
  return parts.length ? parts.join(' · ') : null;
}

/** Whether a step runs at all for this source kind. */
export function stepRuns(step: LoadingStep, kind: SourceKind | null): boolean {
  return kind !== SourceKind.Local || !REMOTE_ONLY_STEPS.has(step);
}

/** The step a list opens on: the first row this source kind actually runs. */
export function firstStepFor(steps: readonly LoadingStep[], kind: SourceKind | null): LoadingStep {
  return steps.find((step) => stepRuns(step, kind)) ?? steps[0];
}

/** Scan phase to step, by source kind. `applied` is the pending of the manifest
 *  the event carried: the only thing telling the two partials apart. */
export function stepForPhase(
  phase: ScanPhase | null,
  kind: SourceKind,
  applied?: Manifest['pending']
): LoadingStep {
  switch (phase) {
    case ScanPhase.CloneProgress:
      return LoadingStep.Cloning;
    case ScanPhase.ScanProgress:
      return LoadingStep.Scanning;
    case ScanPhase.PartialManifest:
      // The skeleton's placeholder heights are what Sketching layout draws. Once
      // metadata has landed the only stage left on the server is the git walk.
      return applied && !applied.includes('metadata') ? LoadingStep.History : LoadingStep.Skeleton;
    case ScanPhase.CompleteManifest:
      return LoadingStep.Building;
    default:
      // phase === null: just-started, no stream event yet.
      return firstStepFor(LOADING_STEPS, kind);
  }
}

// A Record, not a switch: a stage added to the wire contract fails to compile
// here rather than silently falling through to the wrong row.
const TIMELINE_STAGE_STEPS: Record<TimelineStage, LoadingStep> = {
  [TimelineStage.Fetch]: LoadingStep.TimelineFetch,
  [TimelineStage.History]: LoadingStep.TimelineHistory,
  [TimelineStage.Blobs]: LoadingStep.TimelineBlobs,
  // Union assembly, the bundle's trip down the wire, and the pack that follows
  // are one wait with no way to tell them apart: they share the build row.
  [TimelineStage.Assemble]: LoadingStep.Building,
};

/** Timeline stream stage to step. stepForPhase's counterpart for the other stream. */
export function stepForTimelineStage(stage: TimelineStage): LoadingStep {
  return TIMELINE_STAGE_STEPS[stage];
}

// ── Inside "Building city" ───────────────────────────────────────────
export enum BuildStage {
  /** Timeline only: the SERVER assembling the union bundle. Not the client's
   *  work at all, but the same row's wait, so it counts as the first stage. */
  Assembling = 'assembling',
  /** Timeline only: the bundle replayed into per-path timelines, ahead of the
   *  pack. Declared by the caller that runs it, not by the apply. */
  Replay = 'replay',
  /** The roof-icon atlas, rebuilt only when the structure signature changed. */
  Icons = 'icons',
  /** The packer: the worker on a structure change, a cheap in-JS reuse otherwise. */
  Layout = 'layout',
  /** The batch that swaps manifest + layout, and the mesh rebuilds it fires. */
  Assemble = 'assemble',
  /** The deferred pass: tree placement off-thread, then its meshes. The last
   *  stage of every build, and the overlay waits it out. */
  Decorate = 'decorate',
}

/** How far one build has got. The stage list is per-build (see buildStageTail). */
export interface BuildProgress {
  /** The stages this build will run, in order. */
  stages: readonly BuildStage[];
  /** Index into `stages` of the one running now. */
  index: number;
  /** 0-100 within the CURRENT stage, for one that can measure itself; null for
   *  one that only knows it started. buildStageTail spreads it over the plan. */
  percent: number | null;
}

// One word each: the row already says "Building city", and this says which part
// of it. Read beside the percent, never instead of it.
export const BUILD_STAGE_LABELS: Record<BuildStage, string> = {
  [BuildStage.Assembling]: 'assembling',
  [BuildStage.Replay]: 'replaying',
  [BuildStage.Icons]: 'icons',
  [BuildStage.Layout]: 'layout',
  [BuildStage.Assemble]: 'buildings',
  [BuildStage.Decorate]: 'trees',
};

/** What an apply runs at most, for a caller opening the readout before it has a
 *  manifest to ask. A shorter real plan only moves the percent forward. */
export const PACK_STAGES: readonly BuildStage[] = [
  BuildStage.Icons,
  BuildStage.Layout,
  BuildStage.Assemble,
  BuildStage.Decorate,
];

/** The Building row's tail: one percent over the whole build, and the word for
 *  the part it is in — the server's wait and this machine's read alike. */
export function buildStageTail(progress: BuildProgress | null): string | null {
  if (!progress) return null;
  const stage = progress.stages[progress.index];
  if (!stage) return null;
  // A stage that measures itself fills in its own share of the bar; one that
  // only knows it started sits at the foot of its share.
  const within = (progress.percent ?? 0) / 100;
  const percent = Math.round(((progress.index + within) / progress.stages.length) * 100);
  return `${percent}% ${BUILD_STAGE_LABELS[stage]}`;
}
