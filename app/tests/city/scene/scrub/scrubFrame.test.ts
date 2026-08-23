// Reading the world into a frame. The one module that touches the scrub
// position, the ruin settings and the picker, so also the only place
// those still have to be driven into position.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { signal } from '@preact/signals';

import { readScrubFrame } from '@/city/scene/scrub/scrubFrame';
import type { ScrubFrameDeps } from '@/city/scene/scrub/scrubFrame';
import { BUILDING_DIMENSIONS } from '@/city/session/settings/buildings';
import { RUINS } from '@/city/session/settings/ruins';
import { NodeKind } from '@/types';
import type { FileNode, PickTarget, RangeStat, Street, TimelineBundle } from '@/types';
import { makeSession } from '../../../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

const _ruins = RUINS.peek();

const COMMIT_MS = [Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 2), Date.UTC(2024, 0, 3)];
const SCANNED_AT = Date.UTC(2024, 5, 1);

// SCRUB_POS clamps against the bundle, so a position past 0 needs one loaded,
// with dates: the clamp runs a stop past the last commit.
beforeEach(() => {
  session.timeline.bundle.value = {
    commits: COMMIT_MS.map((ms, i) => ({ sha: 'abc'[i], date: new Date(ms).toISOString() })),
    unionManifest: { scanned_at: new Date(SCANNED_AT).toISOString() },
  } as unknown as TimelineBundle;
});
afterEach(() => {
  RUINS.value = _ruins;
  session.timeline.setScrubPos(0);
  session.timeline.bundle.value = null;
});

const RANGES: RangeStat[] = [
  { min: 1, max: 10 },
  { min: 1, max: 20 },
  { min: 1, max: 30 },
];

const dirStreet = { dir: { path: 'src' } } as unknown as Street;
const someFile = { path: 'src/a.txt' } as unknown as FileNode;
const pick = (t: unknown) => t as PickTarget;

function deps(over: Partial<ScrubFrameDeps> = {}): ScrubFrameDeps {
  return {
    scrubPos: session.timeline.scrubPos.peek(),
    config: session.config,
    commitLineRanges: RANGES,
    commitMs: COMMIT_MS,
    trackEndMs: SCANNED_AT,
    byteStats: { min: 1, max: 5000 },
    streetsByDir: { src: dirStreet },
    picker: { selection: signal<PickTarget | null>(null), hover: signal<PickTarget | null>(null) },
    ...over,
  };
}

const at = (pos: number, over: Partial<ScrubFrameDeps> = {}) => {
  session.timeline.setScrubPos(pos);
  return readScrubFrame(deps(over));
};

describe('the scrub position', () => {
  it('comes from SCRUB_POS, fractional part and all', () => {
    expect(at(1.5).pos).toBe(1.5);
  });

  it('picks the line range of the commit it is standing on', () => {
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

describe('what now means mid-scrub', () => {
  it('is the scan date at the today stop, where the city is what Live shows', () => {
    // One past the last commit. Nothing was committed in between, but the city
    // has gone on aging, and that stop is where the track ends.
    expect(at(3).nowMs).toBe(SCANNED_AT);
  });

  it('ages on past the last commit rather than jumping to the scan date', () => {
    const last = COMMIT_MS[2];
    expect(at(2).nowMs).toBe(last);
    const part = at(2.5).nowMs;
    expect(part).toBeGreaterThan(last);
    expect(part).toBeLessThan(SCANNED_AT);
    expect(part).toBe(last + (SCANNED_AT - last) * 0.5);
  });

  it('is the commit under the scrubber when parked on one', () => {
    // Otherwise a repo scrubbed to its first commit paints brand-new files as
    // years old, measured against a date that has not happened yet there.
    expect(at(0).nowMs).toBe(COMMIT_MS[0]);
    expect(at(1).nowMs).toBe(COMMIT_MS[1]);
  });

  // Held at the commit, a quiet stretch aged nothing and then aged everything
  // at once. This is the date the bar prints, so the two agree.
  it('follows the handle between commits, so the city ages as you drag', () => {
    const half = at(0.5).nowMs;
    expect(half).toBeGreaterThan(COMMIT_MS[0]);
    expect(half).toBeLessThan(COMMIT_MS[1]);
    expect(half).toBe(COMMIT_MS[0] + (COMMIT_MS[1] - COMMIT_MS[0]) * 0.5);
    // Monotonic across the whole segment, not just at the midpoint.
    expect(at(0.25).nowMs).toBeLessThan(half);
    expect(at(0.75).nowMs).toBeGreaterThan(half);
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
    // Hover is the more immediate intent. Both modes route through
    // resolveDirTarget so the rule can only be stated once.
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
