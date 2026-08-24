// The tail the "Building city" row renders. Its denominator is the build's own
// plan, so the format has to survive plans of different lengths.

import { describe, it, expect } from 'vitest';
import { BuildStage, buildStageTail } from '@/constants/progress';

const FULL = [BuildStage.Icons, BuildStage.Layout, BuildStage.Assemble];
const REUSE = [BuildStage.Layout, BuildStage.Assemble];

describe('buildStageTail', () => {
  it('says nothing between builds', () => {
    expect(buildStageTail(null)).toBeNull();
  });

  it('spreads one percent over the whole plan, and names the part', () => {
    expect(buildStageTail({ stages: FULL, index: 1, percent: null })).toBe('33% layout');
  });

  it('measures against the stages THIS build runs, not a constant', () => {
    // The same stage, one apply reusing the packed layout and skipping the
    // atlas: it opens that build rather than sitting a third of the way in.
    expect(buildStageTail({ stages: REUSE, index: 0, percent: null })).toBe('0% layout');
  });

  it('fills in a stage that measures itself, within its own share', () => {
    // Second of three, 43% through: a third of the bar plus 43% of the next.
    expect(buildStageTail({ stages: FULL, index: 1, percent: 43 })).toBe('48% layout');
  });

  it('only ever climbs as the plan advances', () => {
    const seen = FULL.map((_, index) =>
      Number(buildStageTail({ stages: FULL, index, percent: null })!.split('%')[0])
    );
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('has a word for every stage', () => {
    for (const [index] of FULL.entries()) {
      expect(buildStageTail({ stages: FULL, index, percent: null })).toMatch(/^\d+% [a-z]+$/);
    }
  });
});
