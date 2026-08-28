// Orchestration only. The controller writes nobody's buffers, so all that is
// left to test is that the slices arrive and the gates agree. Decisions live in
// scrubState.test.ts (buildings and streets), the rollup in scrubPass.test.ts.

import { describe, it, expect, afterEach } from 'vitest';
import { signal } from '@preact/signals';

import { createScrubController } from '@/city/timeline/scrubController';
import type { ScrubGate } from '@/city/timeline/scrubController';
import type { ScrubStates } from '@/city/timeline/scrubPass';
import { BuildingLane } from '@/city/components/buildings/scrubState';
import type { BuildingScrubState } from '@/city/components/buildings/scrubState';
import type { StreetScrubState } from '@/city/components/streets/scrubState';
import { BuildingIndex } from '@/city/components/buildings/buildingIndex';
import { buildPathTimelines } from '@/city/timeline/replay';
import {
  BYTE_STATS,
  LINE_STATS,
  SUBJECT_BUNDLE,
  makeBuilding,
  makeFile,
} from '../../_helpers/scrub';
import type { RangeStat } from '@/city/types/manifest';
import type { Street } from '@/city/types/street';
import type { PickTarget } from '@/city/types/picker';
import { settingSignals } from '../../_helpers/citySettings';
import { createTimelineState } from '@/city/timeline/state';

const TIMELINE = createTimelineState();

const SETTINGS = settingSignals();

afterEach(() => {
  TIMELINE.setBundle(null);
  TIMELINE.setPosition(0);
});

const file = makeFile({ path: 'f.txt' });
const homeStreet = { dir: { path: '' } } as unknown as Street;
const ranges: RangeStat[] = Array.from({ length: 4 }, () => LINE_STATS);

function makeFakeGate(): { gate: ScrubGate; calls: (number | null)[] } {
  const calls: (number | null)[] = [];
  return { gate: { setScrubCommit: (i) => calls.push(i) }, calls };
}

function setup(scrubGates: ScrubGate[] = []) {
  const index = new BuildingIndex();
  index.insert(makeBuilding(file));
  TIMELINE.setBundle(SUBJECT_BUNDLE);

  const buildingSlices: ReadonlyMap<string, BuildingScrubState>[] = [];
  const streetSlices: ReadonlyMap<Street, StreetScrubState>[] = [];
  const footprintSlices: ScrubStates[] = [];

  const controller = createScrubController({
    timeline: TIMELINE,
    settings: SETTINGS,
    buildings: {
      getBuildingIndex: () => index,
      applyScrub: (s) => void buildingSlices.push(s),
    },
    streets: { applyScrub: (s) => void streetSlices.push(s) },
    footprints: { applyScrub: (s) => void footprintSlices.push(s) },
    picker: {
      selection: signal<PickTarget | null>(null),
      hover: signal<PickTarget | null>(null),
    },
    timelines: buildPathTimelines(SUBJECT_BUNDLE),
    commitLineRanges: ranges,
    heightCtx: { lineStats: LINE_STATS, byteStats: BYTE_STATS },
    streetsByDir: { '': homeStreet },
    scrubGates,
  });

  return { controller, buildingSlices, streetSlices, footprintSlices };
}

describe('one update', () => {
  it('hands every component its slice of the same frame', () => {
    const { controller, buildingSlices, streetSlices, footprintSlices } = setup();
    TIMELINE.setPosition(2);
    controller.update();

    expect(buildingSlices).toHaveLength(1);
    expect(streetSlices).toHaveLength(1);
    expect(footprintSlices).toHaveLength(1);
    // Footprints derive from both halves; the other two get only what they own.
    expect(footprintSlices[0].buildings).toBe(buildingSlices[0]);
    expect(footprintSlices[0].streets).toBe(streetSlices[0]);
  });

  it('resolves against the position the scrubber is actually at', () => {
    const { controller, buildingSlices } = setup();
    TIMELINE.setPosition(0);
    controller.update();
    expect(buildingSlices[0].get('f.txt')!.lane).toBe(BuildingLane.Absent);

    TIMELINE.setPosition(2);
    controller.update();
    expect(buildingSlices[1].get('f.txt')!.lane).toBe(BuildingLane.Present);
  });
});

describe('the scrub gates', () => {
  it('floors the position, so a gate opens on whole commits only', () => {
    const a = makeFakeGate();
    const { controller } = setup([a.gate]);
    TIMELINE.setPosition(1.9);
    controller.update();
    expect(a.calls.at(-1)).toBe(1);
  });

  it('gives every gate the identical value, so trees and fireflies cannot drift', () => {
    // Which component sits in which slot is not the point; that they are one
    // interface receiving one value is.
    const a = makeFakeGate();
    const b = makeFakeGate();
    const { controller } = setup([a.gate, b.gate]);
    TIMELINE.setPosition(1.9);
    controller.update();
    expect(a.calls).toEqual(b.calls);
    expect(a.calls).toHaveLength(1);
  });
});

describe('dispose', () => {
  it('drops the model, so a superseded controller stops resolving a dead city', () => {
    const { controller, buildingSlices } = setup();
    controller.dispose();
    TIMELINE.setPosition(2);
    controller.update();
    expect(buildingSlices[0].size).toBe(0);
  });
});
