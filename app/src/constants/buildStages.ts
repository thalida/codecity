// constants/buildStages.ts — the sub-stages one city build runs through, with
// their labels and the tail they render as. Counterpart to loadingSteps.ts: that
// file covers the scan stream's rows, this one covers what happens inside the
// single "Building city" row once the stream has handed over.

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
