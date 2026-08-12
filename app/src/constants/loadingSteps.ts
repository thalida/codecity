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
  // Client-side phase after the city is in the scene but before the decoration
  // pass (trees, future mesa bounds) finishes. Triggered by REBUILD_STATUS →
  // 'decorating'. Only inserted when at least one decoration layer is enabled.
  Decorating = 'decorating',
  // Timeline-mode entry: fetching the history bundle (commits + union manifest).
  TimelineLoading = 'timeline-loading',
}

// Steps in display order. 'skeleton' is the placeholder-painting phase while
// the server resolves per-file metadata; 'building' is the final tween-in of
// real building heights from the populated manifest.
export const LOADING_STEPS: readonly LoadingStep[] = [
  LoadingStep.Resolving,
  LoadingStep.Cloning,
  LoadingStep.Scanning,
  LoadingStep.Skeleton,
  LoadingStep.Building,
  LoadingStep.Decorating,
];

// Timeline-mode entry's own short step list: fetch the history bundle, then
// pack the union city. Reuses LoadingStep.Building rather than inventing a
// second "building the city" label.
export const TIMELINE_LOADING_STEPS: readonly LoadingStep[] = [
  LoadingStep.TimelineLoading,
  LoadingStep.Building,
];

// A step row's progress relative to the active step: not yet reached, the one
// in progress, or already finished. The string values are the `data-state`
// attribute the overlay renders and the CSS (`li[data-state='…']`) styles.
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

/**
 * Map a scan-stream phase to the step it represents, given the source kind
 * (local skips resolving/cloning — see LoadingOverlay's kind-based hiding).
 * Shared by the loading-overlay reactions and ProjectsView's inline progress
 * so the phase→step mapping has exactly one definition.
 */
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
