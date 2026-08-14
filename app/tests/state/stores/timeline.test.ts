import { describe, it, expect, beforeEach } from 'vitest';
import {
  SCRUB_POS,
  SCRUB_MAX,
  SCRUB_DRAGGING,
  SETTLED_COMMIT,
  SETTLED_POS,
  TIMELINE_BUNDLE,
  setScrubPos,
  setTodayMs,
  resetTimelineMode,
} from '@/state/stores/timeline';
import type { TimelineBundle } from '@/types';

// Undated commits leave no today stop, so the newest commit is the last stop.
const bundleOf = (n: number, date?: string) =>
  ({
    commits: Array.from({ length: n }, (_, i) => ({ sha: `c${i}`, date })),
  }) as unknown as TimelineBundle;

describe('SCRUB_POS range', () => {
  beforeEach(() => {
    resetTimelineMode();
  });

  it('is 0 with no bundle loaded', () => {
    expect(SCRUB_MAX.value).toBe(0);
    setScrubPos(5);
    expect(SCRUB_POS.value).toBe(0);
  });

  it('clamps both ends to the loaded bundle', () => {
    TIMELINE_BUNDLE.value = bundleOf(4);
    expect(SCRUB_MAX.value).toBe(3);

    setScrubPos(-2);
    expect(SCRUB_POS.value).toBe(0);
    setScrubPos(99);
    expect(SCRUB_POS.value).toBe(3);
    setScrubPos(1.5); // float index: scrubbing interpolates between commits
    expect(SCRUB_POS.value).toBe(1.5);
  });

  // Restore paths replay a saved position, so a shorter bundle left it out of
  // range until the next write; clamping against the CURRENT bundle fixes that.
  it('re-clamps when the bundle shrinks, with no new write', () => {
    TIMELINE_BUNDLE.value = bundleOf(10);
    setScrubPos(9);
    expect(SCRUB_POS.value).toBe(9);

    TIMELINE_BUNDLE.value = bundleOf(3);
    expect(SCRUB_POS.value).toBe(2);
  });

  it('restores the saved position when the bundle grows back', () => {
    TIMELINE_BUNDLE.value = bundleOf(10);
    setScrubPos(9);
    TIMELINE_BUNDLE.value = bundleOf(3);
    TIMELINE_BUNDLE.value = bundleOf(10);
    expect(SCRUB_POS.value).toBe(9);
  });
});

describe('the settled scrub position', () => {
  beforeEach(() => {
    SCRUB_DRAGGING.value = false;
    resetTimelineMode();
    TIMELINE_BUNDLE.value = bundleOf(10);
  });

  it('holds still through a drag and lands where it comes to rest', () => {
    setScrubPos(2);
    expect(SETTLED_POS.value).toBe(2);
    expect(SETTLED_COMMIT.value).toBe(2);

    SCRUB_DRAGGING.value = true;
    setScrubPos(5);
    setScrubPos(8);
    expect(SETTLED_POS.value).toBe(2);
    expect(SETTLED_COMMIT.value).toBe(2);

    SCRUB_DRAGGING.value = false;
    expect(SETTLED_POS.value).toBe(8);
    expect(SETTLED_COMMIT.value).toBe(8);
  });

  // SETTLED_COMMIT caps at the newest commit, so it reads the same at the today
  // stop past it — the position is the only one of the two that says "the present".
  it('separates the last commit from the today stop past it', () => {
    TIMELINE_BUNDLE.value = bundleOf(10, '2020-01-01T00:00:00Z');
    setTodayMs(Date.parse('2024-01-01T00:00:00Z'));
    expect(SCRUB_MAX.value).toBe(10);

    setScrubPos(9);
    expect(SETTLED_COMMIT.value).toBe(9);
    expect(SETTLED_POS.value).toBe(9);

    setScrubPos(10);
    expect(SETTLED_COMMIT.value).toBe(9);
    expect(SETTLED_POS.value).toBe(10);
  });
});
