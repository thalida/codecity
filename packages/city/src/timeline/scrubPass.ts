// The scrub decision for a whole city, as data. A coordinator exists only
// because street opacity is a rollup over descendant buildings, so the
// buildings must be walked before the streets resolve.

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
import type { Building } from '@/city/types/building';
import type { Street } from '@/city/types/street';

export interface ScrubStates {
  /** Every union building, whether or not it has a mesh. */
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
        // The whole chain, not the direct parent: a container street stays
        // visible while ANY descendant file is live.
        streets: streetChainForDirPath(parentDirPath(path), deps.streetsByDir),
        state,
      });
      buildingStates.set(path, state);
    }
  }

  const allStreets: Street[] = Object.values(deps.streetsByDir);

  // Reused: this runs over every building every frame.
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
      // Even a building without a detail mesh, else its street strands.
      for (const street of entry.streets) {
        if (s.lane === BuildingLane.Present) {
          maxPresentOp.set(street, Math.max(maxPresentOp.get(street) ?? 0, s.op));
          presentStreets.add(street);
        } else if (s.lane === BuildingLane.Ruin) {
          ruinStreets.add(street);
        }
      }
    }

    // Every street each frame, so an orphan cannot stick at a stale opacity.
    streetStates.clear();
    const flags = { ruinsOn: frame.ruinsOn };
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
