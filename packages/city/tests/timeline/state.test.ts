// Where the scrubber can be, and what holds it there: the position clamps to
// the bundle it has, and a drag keeps the SETTLED position still so content
// keyed on it does not refetch per commit crossed.

import { describe, it, expect, beforeEach } from 'vitest';

import { createTimelineState, type TimelineState } from '../../src/timeline/state';
import { makeCommitBundle } from '../_helpers/scrub';

let timeline: TimelineState;
beforeEach(() => {
  timeline = createTimelineState();
});

describe('the scrub position', () => {
  it('is 0 with no bundle loaded', () => {
    expect(timeline.max).toBe(0);
    timeline.setPosition(5);
    expect(timeline.pos).toBe(0);
  });

  it('clamps both ends to the loaded bundle', () => {
    timeline.setBundle(makeCommitBundle(4));
    expect(timeline.max).toBe(3);

    timeline.setPosition(-2);
    expect(timeline.pos).toBe(0);
    timeline.setPosition(99);
    expect(timeline.pos).toBe(3);
    timeline.setPosition(1.5); // float index: scrubbing interpolates between commits
    expect(timeline.pos).toBe(1.5);
  });

  // Restore paths replay a saved position, so a shorter bundle left it out of
  // range until the next write; clamping against the CURRENT bundle fixes that.
  it('re-clamps when the bundle shrinks, with no new write', () => {
    timeline.setBundle(makeCommitBundle(10));
    timeline.setPosition(9);
    expect(timeline.pos).toBe(9);

    timeline.setBundle(makeCommitBundle(3));
    expect(timeline.pos).toBe(2);
  });

  it('restores the saved position when the bundle grows back', () => {
    timeline.setBundle(makeCommitBundle(10));
    timeline.setPosition(9);
    timeline.setBundle(makeCommitBundle(3));
    timeline.setBundle(makeCommitBundle(10));
    expect(timeline.pos).toBe(9);
  });
});

describe('the settled scrub position', () => {
  beforeEach(() => {
    timeline.setBundle(makeCommitBundle(10));
  });

  it('holds still through a drag and lands where it comes to rest', () => {
    timeline.setPosition(2);
    expect(timeline.settledPos).toBe(2);
    expect(timeline.settledCommit).toBe(2);

    timeline.setDragging(true);
    timeline.setPosition(5);
    timeline.setPosition(8);
    expect(timeline.settledPos).toBe(2);
    expect(timeline.settledCommit).toBe(2);

    timeline.setDragging(false);
    expect(timeline.settledPos).toBe(8);
    expect(timeline.settledCommit).toBe(8);
  });

  // SETTLED_COMMIT caps at the newest commit, so it reads the same at the today
  // stop past it — the position is the only one of the two that says "the present".
  it('separates the last commit from the today stop past it', () => {
    timeline.setBundle(makeCommitBundle(10, '2020-01-01T00:00:00Z'));
    timeline.setTodayMs(Date.parse('2024-01-01T00:00:00Z'));
    expect(timeline.max).toBe(10);

    timeline.setPosition(9);
    expect(timeline.settledCommit).toBe(9);
    expect(timeline.settledPos).toBe(9);

    timeline.setPosition(10);
    expect(timeline.settledCommit).toBe(9);
    expect(timeline.settledPos).toBe(10);
  });
});
