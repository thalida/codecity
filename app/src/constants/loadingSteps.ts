// constants/loadingSteps.ts — The loading-overlay step vocabulary: the ordered
// set of phases the manifest stream advances through, plus their display
// labels. A string enum (values match the NDJSON-ish phase names) so call
// sites and the data-step attribute stay self-documenting; the overlay and the
// uiState setters both render/advance from these.

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
