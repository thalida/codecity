// constants/loadingSteps.ts — The loading-overlay step vocabulary: the ordered
// set of phases the manifest stream advances through, plus their display
// labels. A string enum (values match the NDJSON-ish phase names) so call
// sites and the data-step attribute stay self-documenting; the overlay and the
// uiState setters both render/advance from these.

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

// Human-readable label for each step.
export const LOADING_STEP_LABELS: Record<LoadingStep, string> = {
  [LoadingStep.Resolving]: 'Resolving source',
  [LoadingStep.Cloning]: 'Cloning',
  [LoadingStep.Scanning]: 'Scanning files',
  [LoadingStep.Skeleton]: 'Sketching layout',
  [LoadingStep.Building]: 'Building city',
  [LoadingStep.Decorating]: 'Adding decorations',
};
