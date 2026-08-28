// city/status.ts — what a city is doing, as one readable value.
//
// A city announces eleven events across two families, and every one of them is
// a fragment: a phase of a stream, a stage of a build, a count. A host that
// wants to render "what is happening, how far along, and can I show this yet"
// has to fold them, and every host would fold them the same way — so the fold
// lives here, once, and the host reads the answer.
//
// It is a VALUE, not only a stream. A component that mounts after a load
// started, or re-renders mid-build, asks `city.status` and gets the truth;
// nothing has to have been listening. That is the difference between an
// integration point and a transcript.

import { ScanPhase, type ScanProgressEvent } from './client/manifest';
import { BuildStage } from './types/build';
import type { CityEvents } from './events';

/** Is there a city to look at. Independent of whether more is coming: the two
 *  questions are orthogonal, and their combinations are the interesting states.
 *  `Ready` + `fetching` is a real city on screen with history still streaming —
 *  which is a city that is about to grow trees, and a host that cannot express
 *  it reveals one that changes under the reader. */
export enum CityLifecycle {
  /** No city has been built. Nothing has been asked for, or the first is on its
   *  way and there is nothing behind it yet. */
  Empty = 'empty',
  /** Work is in flight and there is nothing on screen to look at yet. */
  Loading = 'loading',
  /** A city is on screen. Check `fetching` for whether it is the final one. */
  Ready = 'ready',
  /** The last thing asked for failed. `error` says what. */
  Error = 'error',
}

/** What a city is doing right now, in ONE vocabulary. The wire and the renderer
 *  each have their own names for their own stages — clone phases, scan phases,
 *  build stages, timeline stages — and a host should not have to learn four
 *  overlapping sets to draw one row. These are what a reader would recognise. */
export enum CityPhase {
  /** Working out what the source string points at, before any transfer. */
  Resolving = 'resolving',
  Cloning = 'cloning',
  Scanning = 'scanning',
  /** A skeleton is up: real structure, placeholder heights, while the server
   *  resolves per-file metadata. */
  Sketching = 'sketching',
  /** Packing and raising the city itself. */
  Building = 'building',
}

/** The raw counts behind the current phase. Facts, not sentences: how to say
 *  "1,204 files" is the host's, including which locale it says it in. */
export interface CityStatusCounts {
  /** Files walked so far, while scanning. */
  filesScanned?: number;
  /** Git's own transfer counters, while cloning. It holds one percent for
   *  minutes on a big fetch, so these are what say it is alive. */
  objects?: number;
  objectsTotal?: number;
  mib?: number;
  /** Working-tree size on disk during the silent promisor blob fetch, which
   *  reports no percent at all. */
  mbOnDisk?: number;
}

/** Everything a host needs to draw a readout, in one object. */
export interface CityStatus {
  readonly lifecycle: CityLifecycle;
  /** More is still coming for the city on screen. A scan streams more than
   *  once — the first manifest is real buildings with git history still on its
   *  way, and history is where commits come from, so trees land on a later
   *  build. True until the manifest being shown says it is final. */
  readonly fetching: boolean;
  readonly phase: CityPhase | null;
  /** Which part of the build is running, inside CityPhase.Building. The phase
   *  is what a row says; this is what the tail beside it says. Null outside a
   *  build. A host that does not care never reads it — which is the difference
   *  between detail and a second vocabulary. */
  readonly stage: BuildStage | null;
  /** 0..1 through the whole of what is running, or null when it cannot be
   *  known. A phase that measures itself fills its own share. */
  readonly fraction: number | null;
  readonly counts: CityStatusCounts;
  /** What this repo is called, as soon as anything knows. */
  readonly label: string | null;
  readonly error: unknown | null;
}

/** A city that has not been asked for anything. What a host initialises its own
 *  signal to, before any city is mounted. */
export const EMPTY_CITY_STATUS: CityStatus = {
  lifecycle: CityLifecycle.Empty,
  fetching: false,
  phase: null,
  stage: null,
  fraction: null,
  counts: {},
  label: null,
  error: null,
};

/** A city's status, folded from its own events. */
export interface CityStatusTracker {
  readonly value: CityStatus;
  /** Hear that it changed. Not applied immediately: a host reads `value` for
   *  the current answer and subscribes for the next one. */
  on(listener: (status: CityStatus) => void): () => void;
  dispose(): void;
}

const PHASE_FOR_SCAN: Partial<Record<ScanPhase, CityPhase>> = {
  [ScanPhase.CloneProgress]: CityPhase.Cloning,
  [ScanPhase.ScanProgress]: CityPhase.Scanning,
  [ScanPhase.PartialManifest]: CityPhase.Sketching,
  [ScanPhase.CompleteManifest]: CityPhase.Building,
};

function countsOf(event: ScanProgressEvent): CityStatusCounts {
  // != null, not !== undefined: these cross the wire, where the type is a
  // promise rather than a guarantee.
  const out: CityStatusCounts = {};
  if (event.phase === ScanPhase.ScanProgress) {
    if (event.files_scanned != null) out.filesScanned = event.files_scanned;
    return out;
  }
  if (event.objects != null) out.objects = event.objects;
  if (event.objects_total != null) out.objectsTotal = event.objects_total;
  if (event.mib != null) out.mib = event.mib;
  if (event.mb_on_disk != null) out.mbOnDisk = event.mb_on_disk;
  return out;
}

/** Where a build has got, over its whole plan rather than the stage it is in:
 *  a stage that measures itself fills its own share, one that only knows it
 *  started sits at the foot of its share. */
function buildFraction(stages: readonly BuildStage[], index: number, percent: number | null) {
  if (index < 0 || stages.length === 0) return null;
  const within = (percent ?? 0) / 100;
  return Math.min(1, (index + within) / stages.length);
}

/** Subscribe half of the city's emitter. Taken structurally so this module and
 *  events.ts do not import each other. */
type Subscribe = <K extends keyof CityEvents>(
  kind: K,
  listener: (payload: CityEvents[K]) => void
) => () => void;

/** Fold one city's events into its status. */
export function createCityStatus(on: Subscribe): CityStatusTracker {
  let value = EMPTY_CITY_STATUS;
  const listeners = new Set<(status: CityStatus) => void>();

  // The build's own plan, for the fraction. Per build, since a reuse apply runs
  // fewer stages than a structural one.
  let stages: readonly BuildStage[] = [];
  let stageIndex = -1;

  /** By content, not identity: every update builds a fresh counts object, so an
   *  identity check would report a change on every event that carries one. */
  function sameCounts(a: CityStatusCounts, b: CityStatusCounts): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof CityStatusCounts>;
    for (const k of keys) if (a[k] !== b[k]) return false;
    return true;
  }

  function set(next: Partial<CityStatus>): void {
    const merged = { ...value, ...next };
    if (
      merged.lifecycle === value.lifecycle &&
      merged.fetching === value.fetching &&
      merged.phase === value.phase &&
      merged.stage === value.stage &&
      merged.fraction === value.fraction &&
      merged.label === value.label &&
      merged.error === value.error &&
      sameCounts(merged.counts, value.counts)
    ) {
      return;
    }
    // Kept, not replaced, when the content matches: a host memoising on the
    // counts object should not see a new one for an unchanged answer.
    if (sameCounts(merged.counts, value.counts)) merged.counts = value.counts;
    value = merged;
    for (const listener of [...listeners]) listener(value);
  }

  /** Ready once anything has been drawn; Loading until then. An error clears
   *  the moment new work starts. */
  const showing = (): CityLifecycle =>
    value.lifecycle === CityLifecycle.Ready ? CityLifecycle.Ready : CityLifecycle.Loading;

  const offs = [
    on('scan:start', () =>
      set({
        lifecycle: showing(),
        fetching: true,
        phase: CityPhase.Resolving,
        stage: null,
        fraction: null,
        counts: {},
        error: null,
      })
    ),
    on('scan:label', ({ label }) => set({ label })),
    on('scan:progress', ({ event }) =>
      set({
        phase: PHASE_FOR_SCAN[event.phase] ?? value.phase,
        fraction:
          event.phase === ScanPhase.CloneProgress && event.percent != null
            ? event.percent / 100
            : null,
        counts: countsOf(event),
      })
    ),
    on('scan:manifest', ({ phase }) => set({ phase: PHASE_FOR_SCAN[phase] ?? value.phase })),
    // The stream ending is not the city appearing: the last manifest still has
    // to be packed and presented, which build:done reports.
    on('scan:done', () => set({})),
    on('scan:error', ({ error }) =>
      set({
        lifecycle: CityLifecycle.Error,
        fetching: false,
        phase: null,
        stage: null,
        fraction: null,
        error,
      })
    ),

    on('build:start', (payload) => {
      stages = payload.stages;
      stageIndex = -1;
      set({
        phase: CityPhase.Building,
        stage: stages[0] ?? null,
        fraction: buildFraction(stages, 0, 0),
        error: null,
      });
    }),
    on('build:stage', ({ stage }) => {
      const next = stages.indexOf(stage);
      if (next > stageIndex) stageIndex = next;
      set({
        phase: CityPhase.Building,
        stage: stages[stageIndex] ?? stage,
        fraction: buildFraction(stages, stageIndex, 0),
      });
    }),
    on('build:progress', ({ percent }) =>
      set({ fraction: buildFraction(stages, Math.max(stageIndex, 0), percent) })
    ),
    // The city is ON SCREEN. `pending` is what the manifest it drew was still
    // waiting on, which is the whole of the fetching question.
    on('build:done', ({ pending }) =>
      set({
        lifecycle: CityLifecycle.Ready,
        fetching: pending.length > 0,
        phase: null,
        stage: null,
        fraction: null,
        counts: {},
      })
    ),
    on('build:error', ({ error }) =>
      set({
        lifecycle: CityLifecycle.Error,
        fetching: false,
        phase: null,
        stage: null,
        fraction: null,
        error,
      })
    ),
  ];

  return {
    get value() {
      return value;
    },
    on(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      for (const off of offs) off();
      listeners.clear();
    },
  };
}
