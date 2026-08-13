// The per-building scrub decision. Every condition is a field on the frame
// literal, so no scene is involved. scrubApply.test.ts covers the buffer
// writes, scrubPass.test.ts the rollup that feeds streets.

import { describe, it, expect } from 'vitest';

import {
  BuildingLane,
  blankBuildingScrubState,
  resolveBuildingScrubState,
} from '@/city/components/buildings/scrubState';
import { BuildingKind } from '@/city/components/buildings/buildingKind';
import { getBuildingColorForRecency } from '@/city/components/buildings/color';
import { getBuildingDimensions } from '@/city/layout/dimensions';
import { FadeDetail } from '@/types';
import type { FileNode } from '@/types';
import {
  BYTE_STATS,
  LINE_STATS,
  SUBJECT_BUNDLE,
  makeBundle,
  makeFile,
  makeScrubFrame,
  scrubSubject,
} from '../../../_helpers/scrub';

const file = makeFile({ path: 'f.txt' });
const NO_COMMIT_MS: readonly number[] = [];

/** The standard subject: created@1 with 2 lines, 6 lines@2, deleted@3. */
function resolve(
  pos: number,
  over: Parameters<typeof makeScrubFrame>[0] = {},
  commitMs: readonly number[] = NO_COMMIT_MS,
  subject = scrubSubject(SUBJECT_BUNDLE, file)
) {
  const frame = makeScrubFrame({ pos, ...over });
  return resolveBuildingScrubState(subject.input, frame, commitMs, blankBuildingScrubState());
}

const heightForLines = (lines: number, stats = LINE_STATS): number =>
  getBuildingDimensions({ ...file, lines } as unknown as FileNode, stats, BYTE_STATS).h;

describe('lane', () => {
  it.each([
    ['before genesis', 0.5, {}, BuildingLane.Absent],
    ['while it exists', 2, {}, BuildingLane.Present],
    ['after deletion with ruins off', 3, {}, BuildingLane.Absent],
    ['after deletion with ruins on', 3, { ruinsOn: true }, BuildingLane.Ruin],
    ['before genesis with blueprints on', 0.5, { futureOn: true }, BuildingLane.Future],
    // Nothing to ruin: the building is still ahead of its own genesis.
    ['before genesis with ruins on', 0, { ruinsOn: true }, BuildingLane.Absent],
    ['after deletion with both on', 3, { ruinsOn: true, futureOn: true }, BuildingLane.Ruin],
  ])('%s', (_label, pos, over, expected) => {
    expect(resolve(pos, over).lane).toBe(expected);
  });
});

describe('height', () => {
  // Height is a value, and a value only moves when a commit moves it. Tweening
  // it made a building grow on days nothing was committed.
  it('holds the line count between commits', () => {
    expect(resolve(1.5).height).toBeCloseTo(resolve(1).height, 5);
    expect(resolve(1.5).height).not.toBeCloseTo(resolve(2).height, 1);
  });

  it('normalizes against the frame line range, not the union baseline', () => {
    // At HEAD this range IS the live scan's, which is what makes the two agree.
    const wide = { min: 1, max: 20_000 };
    const state = resolve(2, { lineStats: wide });
    expect(state.height).toBeCloseTo(heightForLines(6, wide), 5);
    expect(state.height).not.toBeCloseTo(heightForLines(6), 1);
  });

  it('collapses to MIN_FLOORS on a degenerate range, matching a live lone-file commit', () => {
    const degenerate = { min: 6, max: 6 };
    expect(resolve(2, { lineStats: degenerate }).height).toBeCloseTo(
      heightForLines(6, degenerate),
      5
    );
  });

  it('is 0 for an absent building, so the apply can zero-scale it', () => {
    expect(resolve(0.5).height).toBe(0);
  });

  it.each([
    ['a ruin is the uniform stub height, not the height it lived at', 3, { ruinsOn: true }, 1.4],
    ['a future slab is the ultra-low blueprint height', 0.5, { futureOn: true }, 0.2],
  ])('%s', (_label, pos, over, expected) => {
    const state = resolve(pos, over);
    expect(state.height).toBe(expected);
    expect(state.height).toBeLessThan(heightForLines(6));
  });

  it('gates on presence, not line count: a 0-line media file still stands up', () => {
    const media = makeFile({ path: 'm.png', lines: 0, size: 5000, extension: 'png' });
    const mediaBundle = makeBundle({
      commits: [{ sha: 'a' }, { sha: 'b' }],
      deltas: [
        { sha: 'a', changes: [{ path: 'm.png', sha: 's0' }] },
        { sha: 'b', changes: [{ path: 'm.png', sha: 's0' }] },
      ],
      blobLines: { s0: 0 },
    } as never);
    const state = resolve(1, {}, NO_COMMIT_MS, scrubSubject(mediaBundle, media));
    expect(state.lane).toBe(BuildingLane.Present);
    expect(state.height).toBeGreaterThan(0);
    expect(state.op).toBeCloseTo(1, 5);
  });
});

describe('floors', () => {
  it('reflects the line count AT the scrub position, not the union maximum', () => {
    const early = resolve(1).floors;
    const late = resolve(2).floors;
    expect(early).toBeLessThan(late);
    expect(late).toBe(getBuildingDimensions(file, LINE_STATS, BYTE_STATS).floors);
  });

  it.each([
    ['a ruin blanks its facade', 3, { ruinsOn: true }],
    ['a future slab blanks its facade', 0.5, { futureOn: true }],
  ])('%s', (_label, pos, over) => {
    expect(resolve(pos, over).floors).toBe(0);
  });
});

describe('opacity', () => {
  it.each([
    ['present is fully opaque', 2, {}, 1],
    ['a ruin takes the ruin setting', 3, { ruinsOn: true }, 0.3],
    ['a future slab takes the blueprint setting', 0.5, { futureOn: true }, 0.2],
    ['absent is gone', 0.5, {}, 0],
  ])('%s', (_label, pos, over, expected) => {
    expect(resolve(pos, over).op).toBeCloseTo(expected, 5);
  });

  it('is uniform for a future slab however far ahead its creation is', () => {
    expect(resolve(0, { futureOn: true }).op).toBe(resolve(0.9, { futureOn: true }).op);
  });

  it('drives the non-present lanes through the body channel and nothing else', () => {
    const ruin = resolve(3, { ruinsOn: true });
    expect(ruin.bodyOp).toBeCloseTo(0.3, 5);
    expect(ruin.silhouette).toBe(0);
    expect(ruin.outlineOp).toBe(0);
  });
});

describe('the neighborhood fade cascade', () => {
  const cfg = makeScrubFrame().fadeCfg;

  it('multiplies the lane opacity by the tier the live fader would pick', () => {
    // Hovering the building itself is the DEFAULT tier; its outline belongs to
    // outlineRenderer, so this owns body only.
    const state = resolve(2, { hoverFile: file });
    expect(state.bodyOp).toBeCloseTo(cfg.DEFAULT_BODY_OPACITY, 5);
    expect(state.outlineOp).toBe(0);
  });

  it('hides a building whose tier says Hidden', () => {
    const hidden = { ...cfg, DEFAULT_DETAIL: FadeDetail.Hidden };
    expect(resolve(2, { fadeCfg: hidden, hoverFile: file }).bodyOp).toBe(0);
  });

  it('flags the silhouette channel when the tier says Silhouette', () => {
    const silhouette = { ...cfg, DEFAULT_DETAIL: FadeDetail.Silhouette };
    expect(resolve(2, { fadeCfg: silhouette, hoverFile: file }).silhouette).toBe(1);
  });

  it('leaves an absent building alone: there is nothing to dim', () => {
    expect(resolve(0.5, { hoverFile: file }).bodyOp).toBe(0);
  });
});

describe('kind', () => {
  it.each([
    ['normal while present', 2, {}, BuildingKind.Normal],
    ['ruin once deleted', 3, { ruinsOn: true }, BuildingKind.Ruin],
    ['future before genesis', 0.5, { futureOn: true }, BuildingKind.Future],
  ])('%s', (_label, pos, over, expected) => {
    expect(resolve(pos, over).kind).toBe(expected);
  });

  it('reads emptiness off the blob in effect, not the interpolated line count', () => {
    const emptyThenBig = makeBundle({
      commits: [{ sha: 'a' }, { sha: 'b' }],
      deltas: [
        { sha: 'a', changes: [{ path: 'e.txt', sha: 'zero' }] },
        { sha: 'b', changes: [{ path: 'e.txt', sha: 'big' }] },
      ],
      blobLines: { zero: 0, big: 400 },
    } as never);
    const subject = scrubSubject(emptyThenBig, makeFile({ path: 'e.txt' }));
    expect(resolve(0.5, {}, NO_COMMIT_MS, subject).kind).toBe(BuildingKind.Empty);
    expect(resolve(1, {}, NO_COMMIT_MS, subject).kind).toBe(BuildingKind.Normal);
  });

  it('outranks emptiness with ruin and future, so a state change always resets it', () => {
    const alwaysEmpty = makeBundle({
      commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }],
      deltas: [
        { sha: 'a', changes: [] },
        { sha: 'b', changes: [{ path: 'e.txt', sha: 'zero' }] },
        { sha: 'c', changes: [{ path: 'e.txt', sha: null }] },
      ],
      blobLines: { zero: 0 },
    } as never);
    const subject = scrubSubject(alwaysEmpty, makeFile({ path: 'e.txt', lines: 0 }));
    expect(resolve(1, {}, NO_COMMIT_MS, subject).kind).toBe(BuildingKind.Empty);
    expect(resolve(2, { ruinsOn: true }, NO_COMMIT_MS, subject).kind).toBe(BuildingKind.Ruin);
    expect(resolve(0, { futureOn: true }, NO_COMMIT_MS, subject).kind).toBe(BuildingKind.Future);
  });
});

describe('weathering', () => {
  const DAY = 86_400_000;
  const T0 = Date.UTC(2021, 0, 1);
  const commitMs = [T0, T0 + DAY, T0 + 2 * DAY, T0 + 3 * DAY];
  // Wide enough that the subject lands strictly inside it.
  const spread = {
    nowMs: T0 + 4 * DAY,
    minCreated: T0,
    createdSpread: 4 * DAY,
    fadeCfg: { ...makeScrubFrame().fadeCfg, HALF_LIFE_DAYS: 2 },
  };

  it('runs the base colour through the same curve the live view uses', () => {
    // Deliberately not a second copy of the formula: what matters is that both
    // modes call one function, so HEAD matches.
    const state = resolve(2, spread, commitMs);
    const recency = 1 - state.modifiedAge;
    expect(state.colorBase).toBe(getBuildingColorForRecency(file, recency));
    expect(state.colorToward).toBeNull();
  });

  it('reads staler the further now is from the file, and nothing else', () => {
    const near = resolve(2, spread, commitMs).modifiedAge;
    const far = resolve(2, { ...spread, nowMs: T0 + 40 * DAY }, commitMs).modifiedAge;
    expect(near).toBeLessThan(far);
  });

  it('prefers the full-precision file date once past the final change', () => {
    // Same-day commits collapse to one timestamp, flattening HEAD weathering
    // that Live shows spread out. Before the final change there is no such date.
    const surviving = makeBundle({
      commits: [{ sha: 'a' }, { sha: 'b' }, { sha: 'c' }],
      deltas: [
        { sha: 'a', changes: [] },
        { sha: 'b', changes: [{ path: 'f.txt', sha: 's1' }] },
        { sha: 'c', changes: [{ path: 'f.txt', sha: 's2' }] },
      ],
      blobLines: { s1: 2, s2: 6 },
    } as never);
    const dated = makeFile({ path: 'f.txt', modified: new Date(T0 + 2.5 * DAY).toISOString() });
    const subject = scrubSubject(surviving, dated);

    // now is T0+4d, half-life 2d. Past the final change the file's own
    // 2.5-day-old date wins (age 1.5d); before it, commit 1's (age 3d).
    expect(resolve(2, spread, commitMs, subject).modifiedAge).toBeCloseTo(1 - 1 / 1.75, 5);
    expect(resolve(1, spread, commitMs, subject).modifiedAge).toBeCloseTo(1 - 1 / 2.5, 5);
  });

  it('ages a building from its own created date, oldest first', () => {
    const old = scrubSubject(
      SUBJECT_BUNDLE,
      makeFile({ path: 'f.txt', created: new Date(T0).toISOString() })
    );
    const young = scrubSubject(
      SUBJECT_BUNDLE,
      makeFile({ path: 'f.txt', created: new Date(T0 + 3 * DAY).toISOString() })
    );
    expect(resolve(2, spread, commitMs, old).createdAge).toBeGreaterThan(
      resolve(2, spread, commitMs, young).createdAge
    );
  });

  it('leaves an absent building uncoloured rather than writing a value nothing shows', () => {
    const state = resolve(0.5, spread, commitMs);
    expect(state.lane).toBe(BuildingLane.Absent);
    expect(state.colorBase).toBe('');
  });

  it('pulls a ruin toward gray and a future slab toward the blueprint colour', () => {
    const ruin = resolve(3, { ...spread, ruinsOn: true, ruinGrayMix: 0.8 }, commitMs);
    expect(ruin.colorToward).toEqual({ r: 0.3, g: 0.31, b: 0.34 });
    expect(ruin.colorMix).toBe(0.8);

    const futureColor = { r: 0, g: 0.5, b: 1 };
    const future = resolve(
      0.5,
      { ...spread, futureOn: true, futureTint: 0.7, futureColor },
      commitMs
    );
    expect(future.colorToward).toBe(futureColor);
    expect(future.colorMix).toBe(0.7);
  });

  it('samples a ruin and a future slab at mid-recency: neither sits on the date curve', () => {
    const mid = getBuildingColorForRecency(file, 0.5);
    expect(resolve(3, { ...spread, ruinsOn: true }, commitMs).colorBase).toBe(mid);
    expect(resolve(0.5, { ...spread, futureOn: true }, commitMs).colorBase).toBe(mid);
  });
});

describe('the tilt shear', () => {
  it('is zero for the non-present lanes: only a lived-in building leans', () => {
    const ruin = resolve(3, { ruinsOn: true });
    expect(ruin.tiltX).toBe(0);
    expect(ruin.tiltZ).toBe(0);
  });
});

it('resolves into the state it was handed, so a frame allocates nothing per building', () => {
  const out = blankBuildingScrubState();
  const subject = scrubSubject(SUBJECT_BUNDLE, file);
  const returned = resolveBuildingScrubState(
    subject.input,
    makeScrubFrame({ pos: 2 }),
    NO_COMMIT_MS,
    out
  );
  expect(returned).toBe(out);
  expect(out.lane).toBe(BuildingLane.Present);
});
