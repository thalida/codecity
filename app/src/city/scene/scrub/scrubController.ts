// Timeline mode's per-frame driver: read the frame, run the pass, hand each
// component its slice. It writes nobody else's buffers.

import type { TimelineStore } from '@/city/session/stores/timeline';
import type { CityConfig } from '@/city/session/config';
import type { RangeStat } from '@/types';
import type { Street } from '@/city/scene/types';
import type { BuildingIndex } from '@/city/scene/components/buildings/buildingIndex';
import type { BuildingScrubState } from '@/city/scene/components/buildings/scrubState';
import type { StreetScrubState } from '@/city/scene/components/streets/scrubState';
import type { HeightContext } from '@/city/scene/layout/dimensions';
import type { createPicker } from '@/city/scene/interaction/picker';
import type { PathTimeline } from './replay';
import { readScrubFrame } from './scrubFrame';
import { createScrubPass, type ScrubStates } from './scrubPass';
import { parseDateMs } from '@/utils/dates';

/** Anything that dims itself to a scrub position. Trees and fireflies are both
 *  this and nothing more. */
export interface ScrubGate {
  setScrubCommit(maxCommitIndex: number | null): void;
  /** The scrubbed date, for anything sized by how long ago its commit was.
   *  Optional: a gate that only appears and disappears doesn't need it. */
  setScrubNow?(nowMs: number | null): void;
}

export interface ScrubControllerDeps {
  /** The history being scrubbed: this city's, never the app's. */
  timeline: TimelineStore;
  /** And what that city looks like, read fresh each frame. */
  config: CityConfig;
  buildings: {
    /** The union set the pass decides over. */
    getBuildingIndex(): BuildingIndex | null;
    applyScrub(states: ReadonlyMap<string, BuildingScrubState>): void;
  };
  streets: { applyScrub(states: ReadonlyMap<Street, StreetScrubState>): void };
  footprints: { applyScrub(states: ScrubStates): void };
  // Drives the neighborhood fade cascade, since Live's fader is dormant here.
  picker: Pick<ReturnType<typeof createPicker>, 'selection' | 'hover'>;
  timelines: Map<string, PathTimeline>;
  // Backend-computed per commit. heightCtx contributes byteStats only.
  commitLineRanges: RangeStat[];
  heightCtx: HeightContext;
  /** The manifest's scan date: "now" at HEAD, so colour matches Live there. */
  scannedAt?: string | null;
  // { street dir.path → Street } from the union layout.
  streetsByDir: Record<string, Street>;
  scrubGates: ScrubGate[];
}

export function createScrubController(deps: ScrubControllerDeps) {
  // Fixed for the life of the controller; readScrubFrame owns everything that
  // varies per frame.
  const bundle = deps.timeline.bundle.peek();
  const commitMs = (bundle?.commits ?? []).map((c) => parseDateMs(c.date) || 0);
  const scannedAtMs = parseDateMs(deps.scannedAt ?? '') || (commitMs.at(-1) ?? 0);
  // The same last stop the bar ends on, so the two agree about the far end.
  const trackEndMs = deps.timeline.todayMs.peek() ?? scannedAtMs;

  const pass = createScrubPass({
    buildingIndex: deps.buildings.getBuildingIndex(),
    timelines: deps.timelines,
    streetsByDir: deps.streetsByDir,
    commitMs,
  });

  function update(): void {
    const frame = readScrubFrame({
      config: deps.config,
      scrubPos: deps.timeline.scrubPos.peek(),
      commitLineRanges: deps.commitLineRanges,
      commitMs,
      trackEndMs,
      byteStats: deps.heightCtx.byteStats,
      streetsByDir: deps.streetsByDir,
      picker: deps.picker,
    });

    // Capped at the last commit: the today stop past it shows the same commits.
    const gatePos = Math.min(Math.floor(frame.pos), Math.max(0, commitMs.length - 1));
    for (const gate of deps.scrubGates) {
      gate.setScrubCommit(gatePos);
      gate.setScrubNow?.(frame.nowMs);
    }

    const states = pass.run(frame);
    deps.buildings.applyScrub(states.buildings);
    deps.streets.applyScrub(states.streets);
    deps.footprints.applyScrub(states);
  }

  return { update, dispose: pass.dispose };
}
