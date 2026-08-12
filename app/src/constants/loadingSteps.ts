// constants/loadingSteps.ts — the ordered phases the manifest stream advances
// through, with their labels. String enum: the values are the wire phase names,
// so call sites and the data-step attribute stay readable.

import { ScanPhase } from '@/api/manifest';
import { SourceKind } from '@/utils/sources';

export enum LoadingStep {
  Resolving = 'resolving',
  Cloning = 'cloning',
  Scanning = 'scanning',
  Skeleton = 'skeleton',
  Building = 'building',
  // Client-side, between the city landing and the decoration pass finishing.
  // Only inserted when a decoration layer is on.
  Decorating = 'decorating',
  // Timeline-mode entry: fetching the history bundle (commits + union manifest).
  TimelineLoading = 'timeline-loading',
}

// Display order. 'skeleton' paints placeholders while the server resolves
// per-file metadata; 'building' tweens in the real heights.
export const LOADING_STEPS: readonly LoadingStep[] = [
  LoadingStep.Resolving,
  LoadingStep.Cloning,
  LoadingStep.Scanning,
  LoadingStep.Skeleton,
  LoadingStep.Building,
  LoadingStep.Decorating,
];

// Timeline's own short list. Reuses LoadingStep.Building rather than inventing
// a second label for the same act.
export const TIMELINE_LOADING_STEPS: readonly LoadingStep[] = [
  LoadingStep.TimelineLoading,
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
  [LoadingStep.Decorating]: 'Adding decorations',
  [LoadingStep.TimelineLoading]: 'Loading history',
};

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
      return kind === SourceKind.Local ? LoadingStep.Scanning : LoadingStep.Resolving;
  }
}
