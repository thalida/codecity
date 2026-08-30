// features/city/state/loading.ts — the vocabulary of one load, at two grains: the rows
// the overlay advances through, and the sub-stages that run inside its last row
// once the stream has handed over to the build.

import { CityPhase, TimelineStage, BuildStage, type CityStatus, SourceKind } from '@codecity/city';

// ── The overlay's rows ───────────────────────────────────────────────

// Timeline-mode entry, one row per stage of the history stream: the blob
// backfill, the commit walk, then blob resolution. Ours until that stream is
export enum TimelineStep {
  TimelineFetch = 'timeline-fetch',
  TimelineHistory = 'timeline-history',
  TimelineBlobs = 'timeline-blobs',
}

/** A row of the overlay. The city's phases, plus the timeline stream's. */
export type LoadingStep = CityPhase | TimelineStep;

/** The rows, by the names the city uses for its own. */
export const LoadingStep = { ...CityPhase, ...TimelineStep } as const;

// Display order. 'skeleton' paints placeholders while the server resolves
// per-file metadata; 'building' tweens in the real heights and ends every list.
export const LOADING_STEPS: readonly LoadingStep[] = [
  CityPhase.Resolving,
  CityPhase.Cloning,
  CityPhase.Scanning,
  CityPhase.Sketching,
  CityPhase.Building,
];

// Timeline's own list. Reuses LoadingStep.Building rather than inventing
// a second label for the same act.
export const TIMELINE_LOADING_STEPS: readonly LoadingStep[] = [
  TimelineStep.TimelineFetch,
  TimelineStep.TimelineHistory,
  TimelineStep.TimelineBlobs,
  CityPhase.Building,
];

// Where a row sits relative to the active step. The values are the
// `data-state` attribute the overlay renders and the CSS styles.
export enum LoadingStepState {
  Pending = 'pending',
  Active = 'active',
  Done = 'done',
}

// Human-readable label for each step.
// What each row is CALLED is this app's, which is the only part of a row that
export const LOADING_STEP_LABELS: Record<LoadingStep, string> = {
  [CityPhase.Resolving]: 'Resolving source',
  [CityPhase.Cloning]: 'Cloning',
  [CityPhase.Scanning]: 'Scanning files',
  [CityPhase.Sketching]: 'Sketching layout',
  [CityPhase.Building]: 'Building city',
  [TimelineStep.TimelineFetch]: 'Fetching history',
  [TimelineStep.TimelineHistory]: 'Walking commits',
  [TimelineStep.TimelineBlobs]: 'Resolving files',
};

// Steps that exist only for a remote source: a path already on disk has
// nothing to resolve, clone, or fetch.
const REMOTE_ONLY_STEPS: ReadonlySet<LoadingStep> = new Set<LoadingStep>([
  CityPhase.Resolving,
  CityPhase.Cloning,
  TimelineStep.TimelineFetch,
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

/** The counts behind the current phase, as this app says them. Facts are the
 *  city's; the words and the locale are ours. */
export function countsTail(status: CityStatus): string | null {
  const c = status.counts;
  if (c.filesScanned != null) return `${c.filesScanned.toLocaleString()} files`;
  const parts: string[] = [];
  if (status.fraction != null) parts.push(`${Math.round(status.fraction * 100)}%`);
  if (c.objects != null && c.objectsTotal != null) {
    parts.push(`${c.objects.toLocaleString()}/${c.objectsTotal.toLocaleString()}`);
  }
  if (c.mib != null) parts.push(`${c.mib.toLocaleString()} MiB`);
  // The silent promisor blob fetch reports no percent at all, and shows the
  // working tree growing on disk instead.
  if (!parts.length && c.mbOnDisk != null) parts.push(`${c.mbOnDisk} MB`);
  return parts.length ? parts.join(' · ') : null;
}

// A Record, not a switch: a stage added to the wire contract fails to compile
// here rather than silently falling through to the wrong row.
const TIMELINE_STAGE_STEPS: Record<TimelineStage, LoadingStep> = {
  [TimelineStage.Fetch]: TimelineStep.TimelineFetch,
  [TimelineStage.History]: TimelineStep.TimelineHistory,
  [TimelineStage.Blobs]: TimelineStep.TimelineBlobs,
  // Union assembly, the bundle's trip down the wire, and the pack that follows
  // are one wait with no way to tell them apart: they share the build row.
  [TimelineStage.Assemble]: CityPhase.Building,
};

/** Timeline stream stage to step. stepForPhase's counterpart for the other stream. */
export function stepForTimelineStage(stage: TimelineStage): LoadingStep {
  return TIMELINE_STAGE_STEPS[stage];
}

// ── Inside "Building city" ───────────────────────────────────────────
// The stages themselves are the city's: it is the thing running them. What
export { BuildStage };

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

/** The Building row's tail: the city's own fraction over the whole build, and
 *  this app's word for the part it is in. */
export function buildStageTail(status: CityStatus): string | null {
  if (status.fraction == null) return null;
  const percent = `${Math.round(status.fraction * 100)}%`;
  return status.stage ? `${percent} ${BUILD_STAGE_LABELS[status.stage]}` : percent;
}
