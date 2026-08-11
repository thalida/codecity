// Reading the world into a frame. This is the one module that touches the
// scrub position, the ruin/blueprint settings and the picker, so it is also the
// only place those still have to be driven into position.

import * as THREE from 'three';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { signal } from '@preact/signals';

import { FUTURE_SLAB_FLOORS, readScrubFrame } from '@/city/timeline/scrubFrame';
import type { ScrubFrameDeps } from '@/city/timeline/scrubFrame';
import { TIMELINE_BUNDLE, setScrubPos } from '@/state/stores/timeline';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { RUINS } from '@/state/stores/settings/ruins';
import { BLUEPRINTS } from '@/state/stores/settings/blueprints';
import { NodeKind } from '@/types';
import type { FileNode, PickTarget, RangeStat, Street, TimelineBundle } from '@/types';

const _ruins = RUINS.peek();
const _blueprints = BLUEPRINTS.peek();

// SCRUB_POS clamps against the loaded bundle, so a three-commit one is what
// makes a position of 1.5 (or 2) reachable at all.
beforeEach(() => {
  TIMELINE_BUNDLE.value = {
    commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }],
  } as unknown as TimelineBundle;
});
afterEach(() => {
  RUINS.value = _ruins;
  BLUEPRINTS.value = _blueprints;
  setScrubPos(0);
  TIMELINE_BUNDLE.value = null;
});

const RANGES: RangeStat[] = [
  { min: 1, max: 10 },
  { min: 1, max: 20 },
  { min: 1, max: 30 },
];
const DATE_RANGES = [
  { minCreated: 0, maxCreated: 10, minModified: 0, maxModified: 10 },
  { minCreated: 5, maxCreated: 25, minModified: 5, maxModified: 45 },
];

const dirStreet = { dir: { path: 'src' } } as unknown as Street;
const someFile = { path: 'src/a.txt' } as unknown as FileNode;
const pick = (t: unknown) => t as PickTarget;

function deps(over: Partial<ScrubFrameDeps> = {}): ScrubFrameDeps {
  return {
    commitLineRanges: RANGES,
    commitDateRanges: DATE_RANGES,
    byteStats: { min: 1, max: 5000 },
    streetsByDir: { src: dirStreet },
    picker: { selection: signal<PickTarget | null>(null), hover: signal<PickTarget | null>(null) },
    ...over,
  };
}

const at = (pos: number, over: Partial<ScrubFrameDeps> = {}) => {
  setScrubPos(pos);
  return readScrubFrame(deps(over));
};

describe('the scrub position', () => {
  it('comes from SCRUB_POS, fractional part and all', () => {
    expect(at(1.5).pos).toBe(1.5);
  });

  it('picks the line range of the commit it is standing on', () => {
    // Height normalizes against range[floor(pos)] so Timeline matches
    // Live-at-that-commit rather than the union baseline.
    expect(at(1.9).lineStats).toEqual({ min: 1, max: 20 });
  });

  it('clamps to the last range when the backend sent fewer than there are commits', () => {
    expect(at(2, { commitLineRanges: RANGES.slice(0, 1) })).toHaveProperty('lineStats', RANGES[0]);
  });

  it('substitutes a safe range for a degenerate one, so nothing divides by zero', () => {
    const frame = at(0, { commitLineRanges: [{ min: 0, max: 0 }] });
    expect(frame.lineStats).toEqual({ min: 1, max: 1 });
  });
});

describe('the ruin settings', () => {
  it('resolves the stub height into world units, uniform across every building', () => {
    RUINS.value = { ..._ruins, ENABLED: true, STUB_HEIGHT: 0.5, BUILDING_OPACITY: 0.3 };
    const frame = at(0);
    expect(frame.ruinsOn).toBe(true);
    expect(frame.ruinHeight).toBeCloseTo(0.5 * BUILDING_DIMENSIONS.peek().FLOOR_HEIGHT, 5);
    expect(frame.ruinBuildingOpacity).toBe(0.3);
  });
});

describe('the blueprint settings', () => {
  it('resolves the slab height from the fixed floor count', () => {
    BLUEPRINTS.value = { ..._blueprints, ENABLED: true, BUILDING_OPACITY: 0.2 };
    const frame = at(0);
    expect(frame.futureOn).toBe(true);
    expect(frame.futureHeight).toBeCloseTo(
      FUTURE_SLAB_FLOORS * BUILDING_DIMENSIONS.peek().FLOOR_HEIGHT,
      5
    );
    expect(frame.futureBuildingOpacity).toBe(0.2);
  });

  it('converts the blueprint colour into working space, ready to lerp toward', () => {
    // Carrying components rather than the CSS string is what keeps the scrub
    // decision free of THREE; the conversion has to happen exactly once, here.
    BLUEPRINTS.value = { ..._blueprints, BUILDING_COLOR: '#3366ff' };
    const expected = new THREE.Color('#3366ff');
    const { futureColor } = at(0);
    expect(futureColor.r).toBeCloseTo(expected.r, 6);
    expect(futureColor.g).toBeCloseTo(expected.g, 6);
    expect(futureColor.b).toBeCloseTo(expected.b, 6);
  });
});

describe('the weathering span', () => {
  it('reads the replayed date range for the commit it is standing on', () => {
    const frame = at(1);
    expect(frame.minMod).toBe(5);
    expect(frame.modSpread).toBe(40);
    expect(frame.minCreated).toBe(5);
    expect(frame.createdSpread).toBe(20);
  });

  it('clamps past the end, so scrubbing to HEAD keeps the last real span', () => {
    expect(at(99).minMod).toBe(5);
  });

  it('falls back to a zero span when the backend sent no ranges', () => {
    // Spread 0 means every present file reads freshest, which is what Live does
    // for a single-file repo rather than dividing by zero.
    const frame = at(0, { commitDateRanges: [] });
    expect(frame.minMod).toBe(0);
    expect(frame.modSpread).toBe(0);
  });
});

describe('the fade cascade targets', () => {
  it('carries a selected file straight through as the building target', () => {
    const selection = signal<PickTarget | null>(pick({ kind: NodeKind.File, file: someFile }));
    const frame = at(0, {
      picker: { selection, hover: signal<PickTarget | null>(null) },
    });
    expect(frame.bldgTargetFile).toBe(someFile);
    // A selected file radiates from its parent directory.
    expect(frame.dirTarget).toBe(dirStreet.dir);
  });

  it('lets a hovered directory take over the cascade from a selected file', () => {
    // Hover is the more immediate intent, so it wins — the same rule the live
    // fader applies, which is why both route through resolveDirTarget.
    const frame = at(0, {
      streetsByDir: { other: dirStreet },
      picker: {
        selection: signal<PickTarget | null>(
          pick({ kind: NodeKind.File, file: { path: 'other/b.txt' } })
        ),
        hover: signal<PickTarget | null>(
          pick({ kind: NodeKind.Directory, street: dirStreet, dir: dirStreet.dir })
        ),
      },
    });
    expect(frame.hoverFile).toBeNull();
    expect(frame.dirTarget).toBe(dirStreet.dir);
  });

  it('leaves every target null when nothing is picked', () => {
    const frame = at(0);
    expect(frame.bldgTargetFile).toBeNull();
    expect(frame.hoverFile).toBeNull();
    expect(frame.dirTarget).toBeNull();
  });
});
