// constants/buildStages.ts — the sub-stages one city build runs through, with
// their labels and the tail they render as. Counterpart to loadingSteps.ts: that
// file covers the scan stream's rows, this one covers what happens inside the
// single "Building city" row once the stream has handed over.

export enum BuildStage {
  /** Timeline only: the bundle replayed into per-path timelines, ahead of the
   *  pack. Declared by the caller that runs it, not by the apply. */
  Replay = 'replay',
  /** The roof-icon atlas, rebuilt only when the structure signature changed. */
  Icons = 'icons',
  /** The packer: the worker on a structure change, a cheap in-JS reuse otherwise. */
  Layout = 'layout',
  /** The batch that swaps manifest + layout, and the mesh rebuilds it fires. */
  Assemble = 'assemble',
  /** The deferred pass: tree placement off-thread, then its meshes. Runs with
   *  the city already up, and outlives the overlay in Live. */
  Decorate = 'decorate',
}

/** How far one build has got. The stage list is per-build (see buildStageTail). */
export interface BuildProgress {
  /** The stages this build will run, in order. */
  stages: readonly BuildStage[];
  /** Index into `stages` of the one running now. */
  index: number;
  /** Progress within the current stage, where it can measure itself (the layout
   *  worker counts placements); null for a stage that only knows it started. */
  percent: number | null;
}

// One word each, naming what the stage makes: they render as a tail after the
// row's own "Building city", and a slow one is the only one you read.
export const BUILD_STAGE_LABELS: Record<BuildStage, string> = {
  [BuildStage.Replay]: 'history',
  [BuildStage.Icons]: 'icons',
  [BuildStage.Layout]: 'layout',
  [BuildStage.Assemble]: 'buildings',
  [BuildStage.Decorate]: 'trees',
};

/** The Building row's tail: the running stage, and how far through the plan it
 *  is. The denominator is the plan's, since not every apply runs every stage. */
export function buildStageTail(progress: BuildProgress | null): string | null {
  if (!progress) return null;
  const stage = progress.stages[progress.index];
  if (!stage) return null;
  const count = `${progress.index + 1}/${progress.stages.length}`;
  const label = BUILD_STAGE_LABELS[stage];
  // A stage that measures itself leads with its own percent; the step count
  // moves into parentheses behind it rather than competing for the front.
  return progress.percent != null
    ? `${label} ${progress.percent}% (${count})`
    : `${label} ${count}`;
}
