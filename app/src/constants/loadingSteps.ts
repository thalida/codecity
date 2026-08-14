// constants/loadingSteps.ts — the ordered phases the manifest stream advances
// through, with their labels. String enum: the values are the wire phase names,
// so call sites and the data-step attribute stay readable.

import { ScanPhase } from '@/api/manifest';
import { SourceKind } from '@/utils/sources';
import type { TimelineProgress } from '@/types';

export enum LoadingStep {
  Resolving = 'resolving',
  Cloning = 'cloning',
  Scanning = 'scanning',
  Skeleton = 'skeleton',
  Building = 'building',
  // Timeline-mode entry, one row per stage of the history stream: the blob
  // backfill, the commit walk, then blob resolution.
  TimelineFetch = 'timeline-fetch',
  TimelineHistory = 'timeline-history',
  TimelineBlobs = 'timeline-blobs',
}

// Display order. 'skeleton' paints placeholders while the server resolves
// per-file metadata; 'building' tweens in the real heights and ends every list.
export const LOADING_STEPS: readonly LoadingStep[] = [
  LoadingStep.Resolving,
  LoadingStep.Cloning,
  LoadingStep.Scanning,
  LoadingStep.Skeleton,
  LoadingStep.Building,
];

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

/** Whether a step runs at all for this source kind. */
export function stepRuns(step: LoadingStep, kind: SourceKind | null): boolean {
  return kind !== SourceKind.Local || !REMOTE_ONLY_STEPS.has(step);
}

/** The step a list opens on: the first row this source kind actually runs. */
export function firstStepFor(steps: readonly LoadingStep[], kind: SourceKind | null): LoadingStep {
  return steps.find((step) => stepRuns(step, kind)) ?? steps[0];
}

/** Scan phase to step, by source kind: local skips resolving and cloning. One
 *  definition, shared by the overlay reactions and the inline progress. */
export function stepForPhase(phase: ScanPhase | null, kind: SourceKind): LoadingStep {
  switch (phase) {
    case ScanPhase.CloneProgress:
      return LoadingStep.Cloning;
    case ScanPhase.ScanProgress:
      return LoadingStep.Scanning;
    case ScanPhase.PartialManifest:
      return LoadingStep.Skeleton;
    case ScanPhase.CompleteManifest:
      return LoadingStep.Building;
    default:
      // phase === null: just-started, no stream event yet.
      return firstStepFor(LOADING_STEPS, kind);
  }
}

// A Record, not a switch: a stage added to the wire contract fails to compile
// here rather than silently falling through to the wrong row.
const TIMELINE_STAGE_STEPS: Record<TimelineProgress['stage'], LoadingStep> = {
  fetch: LoadingStep.TimelineFetch,
  history: LoadingStep.TimelineHistory,
  blobs: LoadingStep.TimelineBlobs,
  // Union assembly, the bundle's trip down the wire, and the pack that follows
  // are one wait with no way to tell them apart: they share the build row.
  assemble: LoadingStep.Building,
};

/** Timeline stream stage to step. stepForPhase's counterpart for the other stream. */
export function stepForTimelineStage(stage: TimelineProgress['stage']): LoadingStep {
  return TIMELINE_STAGE_STEPS[stage];
}
