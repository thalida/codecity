// Resizing the orb field to a scrub position: an author's orbs say how much of
// the work is theirs, and that has to be the work done BY THAT DATE.

import { describe, it, expect } from 'vitest';
import { createFirefliesScrub } from '../../../src/components/fireflies/firefliesScrub';
import { placeFireflies } from '../../../src/components/fireflies/firefliesPlacement';
import { commits as buildCommits } from '../../_helpers/commits';
import { commitStats } from '../../_helpers/statsFixtures';
import { TEST_TREES, treePlacement } from '../../_helpers/cityFixtures';
import { parseDateMs } from '../../../src/utils/dates';
import { settingsStore } from '../../_helpers/citySettings';

// Canopy width follows height only with the age attenuation on, and the orb
// scale range is what these assertions read.
const SETTINGS = settingsStore({
  TREES: { ...TEST_TREES, WIDTH_AGE_FLOOR: 0.2 },
  FIREFLIES: { SCALE_MIN: 1, SCALE_MAX: 5 },
});

// Ada commits three times, Grace once, so their orbs differ at HEAD and Ada's
// grows across the run while Grace's appears at the end.
const COMMITS = buildCommits(
  { date: '2026-01-01', files: 1, authors: ['Ada'] },
  { date: '2026-02-01', files: 1, authors: ['Ada'] },
  { date: '2026-03-01', files: 1, authors: ['Ada'] },
  { date: '2026-04-01', files: 1, authors: ['Grace'] }
);
const STATS = commitStats(COMMITS);
const SCANNED = '2026-04-01';
// The app's parse, so a date string here is the same moment the scene reads.
const ms = (d: string) => parseDateMs(d);

function field() {
  const placements = COMMITS.map((_, i) => treePlacement(i, i * 200, 0));
  const orbs = placeFireflies(SETTINGS, placements, COMMITS, STATS, SCANNED);
  return { orbs, scrub: createFirefliesScrub(SETTINGS, orbs, COMMITS, STATS, SCANNED) };
}

const scaleOf = (orbs: ReturnType<typeof field>['orbs'], author: string) =>
  orbs.find((o) => o.author === author)!.scale;

describe('createFirefliesScrub', () => {
  it('sizes an author by the commits made so far, not their whole history', () => {
    const { orbs, scrub } = field();
    const atHead = scaleOf(orbs, 'Ada');

    scrub.resize(0, ms('2026-01-01'));
    const afterOne = scaleOf(orbs, 'Ada');
    scrub.resize(1, ms('2026-02-01'));
    const afterTwo = scaleOf(orbs, 'Ada');

    expect(afterOne).toBeLessThan(afterTwo);
    expect(afterTwo).toBeLessThan(atHead);
    // Three of three commits at the end: back to the size Live draws.
    scrub.resize(3, ms(SCANNED));
    expect(scaleOf(orbs, 'Ada')).toBeCloseTo(atHead, 5);
  });

  it('holds an author who has not committed yet at the floor', () => {
    const { orbs, scrub } = field();
    scrub.resize(1, ms('2026-02-01'));
    expect(scaleOf(orbs, 'Grace')).toBe(SETTINGS.FIREFLIES.SCALE_MIN);
    scrub.resize(3, ms(SCANNED));
    expect(scaleOf(orbs, 'Grace')).toBeGreaterThan(SETTINGS.FIREFLIES.SCALE_MIN);
  });

  it('scrubs the orbit onto the tree as it is at that date, not as it ends up', () => {
    const { orbs, scrub } = field();
    const orb = orbs.find((o) => o.commitIndex === 0)!;
    const { height, orbitRadius } = orb;

    // The first commit's tree is younger a month in than at the scan date.
    scrub.resize(0, ms('2026-01-02'));
    expect(orb.height).toBeLessThan(height);
    expect(orb.orbitRadius).toBeLessThan(orbitRadius);
    // Its place on the canopy is fixed; the tree it hangs on is what moved, so
    // scrubbing back to the scan date puts the orbit exactly where it was.
    scrub.resize(3, ms(SCANNED));
    expect(orb.height).toBeCloseTo(height, 5);
    expect(orb.orbitRadius).toBeCloseTo(orbitRadius, 5);
  });

  it('restores the live sizes exactly on the way back out', () => {
    const { orbs, scrub } = field();
    const before = orbs.map((o) => ({ ...o }));
    scrub.resize(0, ms('2026-01-01'));
    expect(scrub.resize(null, null)).toBe(true);
    expect(orbs.map((o) => ({ ...o }))).toEqual(before);
    // Nothing left to restore, so nothing to re-upload.
    expect(scrub.resize(null, null)).toBe(false);
  });

  it('reports no change when the position has not moved, so nothing re-uploads', () => {
    const { scrub } = field();
    expect(scrub.resize(1, ms('2026-02-01'))).toBe(true);
    expect(scrub.resize(1, ms('2026-02-01'))).toBe(false);
    expect(scrub.resize(1, ms('2026-02-02'))).toBe(true);
  });

  it('counts the same either way round the history, walking forward or back', () => {
    const { orbs, scrub } = field();
    scrub.resize(2, ms('2026-03-01'));
    const forward = scaleOf(orbs, 'Ada');
    scrub.resize(3, ms(SCANNED));
    scrub.resize(2, ms('2026-03-01'));
    expect(scaleOf(orbs, 'Ada')).toBe(forward);
  });

  it('credits every author of a co-authored commit', () => {
    const shared = buildCommits(
      { date: '2026-01-01', files: 1, authors: ['Ada', 'Grace'] },
      { date: '2026-02-01', files: 1, authors: ['Ada'] }
    );
    const stats = commitStats(shared);
    const orbs = placeFireflies(
      SETTINGS,
      [treePlacement(0, 0, 0), treePlacement(1, 200, 0)],
      shared,
      stats
    );
    const scrub = createFirefliesScrub(SETTINGS, orbs, shared, stats, '2026-02-01');
    scrub.resize(0, ms('2026-01-01'));
    // One commit each after the first: Grace is not behind Ada yet.
    expect(scaleOf(orbs, 'Grace')).toBe(scaleOf(orbs, 'Ada'));
    scrub.resize(1, ms('2026-02-01'));
    expect(scaleOf(orbs, 'Grace')).toBeLessThan(scaleOf(orbs, 'Ada'));
  });

  it('leaves TREES untouched: it reads the config, it does not write it', () => {
    const before = SETTINGS.TREES;
    const { scrub } = field();
    scrub.resize(1, ms('2026-02-01'));
    expect(SETTINGS.TREES).toBe(before);
  });
});
