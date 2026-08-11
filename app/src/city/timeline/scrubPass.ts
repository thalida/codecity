// The scrub decision for a whole city, as data. Given a ScrubFrame it produces
// a state per building and a state per street, touching no meshes, no
// components and no per-frame signals — which is what makes the rules testable
// without a scene.
//
// A coordinator is warranted here (rather than each component deciding for
// itself) for one reason: a street's opacity is a rollup over its descendant
// buildings, so somebody has to walk the buildings before the streets can be
// resolved. That rollup is the entire justification for this module.

import type { Building, Street } from '@/types';
import type { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import {
  BuildingLane,
  blankBuildingScrubState,
  resolveBuildingScrubState,
  type BuildingScrubInput,
  type BuildingScrubState,
} from '@/city/components/buildings/scrubState';
import {
  resolveStreetScrubState,
  type StreetRollup,
  type StreetScrubState,
} from '@/city/components/streets/scrubState';
import { streetChainForDirPath } from '@/city/layout/streetPath';
import { parentDirPath } from '@/city/utils/path';
import type { PathTimeline } from './replay';
import type { ScrubFrame } from './scrubFrame';

export interface ScrubStates {
  /** Keyed by file path — every union building, whether or not it has a mesh. */
  buildings: ReadonlyMap<string, BuildingScrubState>;
  streets: ReadonlyMap<Street, StreetScrubState>;
}

export interface ScrubPassDeps {
  buildingIndex: BuildingIndex | null;
  timelines: Map<string, PathTimeline>;
  /** { street dir.path → Street } from the union layout. */
  streetsByDir: Record<string, Street>;
  /** Commit dates as ms, for date-based weathering. */
  commitMs: readonly number[];
}

/** One building paired with its timeline, its FULL ancestor street chain and
 *  the state object it resolves into each frame. */
interface ScrubEntry {
  input: BuildingScrubInput;
  streets: Street[];
  state: BuildingScrubState;
}

export function createScrubPass(deps: ScrubPassDeps) {
  const entries: ScrubEntry[] = [];
  const buildingStates = new Map<string, BuildingScrubState>();

  if (deps.buildingIndex) {
    for (const b of deps.buildingIndex.byPath.values()) {
      const path = (b as Building).file?.path;
      if (!path) continue;
      const pt = deps.timelines.get(path);
      if (!pt) continue;
      const state = blankBuildingScrubState();
      entries.push({
        input: {
          b,
          pt,
          createdIdx: pt.intervals.length ? pt.intervals[0].start : 0,
          finalIdx: pt.changes.length ? pt.changes[pt.changes.length - 1].i : 0,
        },
        // A container street stays visible while ANY descendant file is live,
        // so this is the whole ancestor chain, not just the direct parent.
        streets: streetChainForDirPath(parentDirPath(path), deps.streetsByDir),
        state,
      });
      buildingStates.set(path, state);
    }
  }

  const allStreets: Street[] = Object.values(deps.streetsByDir);

  // Rollup scratch, reused across frames — this runs every frame over every
  // building, so nothing here may allocate in steady state.
  const maxPresentOp = new Map<Street, number>();
  const ruinStreets = new Set<Street>();
  const presentStreets = new Set<Street>();
  const rollup: StreetRollup = { presentStreets, maxPresentOp, ruinStreets };
  const streetStates = new Map<Street, StreetScrubState>();

  function run(frame: ScrubFrame): ScrubStates {
    maxPresentOp.clear();
    ruinStreets.clear();
    presentStreets.clear();

    for (const entry of entries) {
      const s = resolveBuildingScrubState(entry.input, frame, deps.commitMs, entry.state);
      // Rolled up for EVERY union building, even one without a detail mesh,
      // else the footprints and streets above it strand at their defaults.
      for (const street of entry.streets) {
        if (s.lane === BuildingLane.Present) {
          maxPresentOp.set(street, Math.max(maxPresentOp.get(street) ?? 0, s.op));
          presentStreets.add(street);
        } else if (s.lane === BuildingLane.Ruin) {
          ruinStreets.add(street);
        }
      }
    }

    // Every street is resolved each frame, defaulting to 0, so an orphaned
    // street cannot stick at a stale opacity.
    streetStates.clear();
    const flags = { ruinsOn: frame.ruinsOn, futureOn: frame.futureOn };
    for (const street of allStreets) {
      streetStates.set(street, resolveStreetScrubState(street, rollup, flags));
    }

    return { buildings: buildingStates, streets: streetStates };
  }

  function dispose(): void {
    entries.length = 0;
    buildingStates.clear();
    streetStates.clear();
  }

  return { run, dispose };
}
