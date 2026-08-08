import { describe, it, expect, beforeEach } from 'vitest';
import {
  SCRUB_POS,
  SCRUB_MAX,
  TIMELINE_BUNDLE,
  setScrubPos,
  resetTimelineMode,
} from '@/state/stores/timeline';
import type { TimelineBundle } from '@/types';

const bundleOf = (n: number) =>
  ({
    commits: Array.from({ length: n }, (_, i) => ({ sha: `c${i}` })),
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
