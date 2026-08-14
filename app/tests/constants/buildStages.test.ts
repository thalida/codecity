// The tail the "Building city" row renders. Its denominator is the build's own
// plan, so the format has to survive plans of different lengths.

import { describe, it, expect } from 'vitest';
import { BuildStage, buildStageTail } from '@/constants/buildStages';

const FULL = [BuildStage.Icons, BuildStage.Layout, BuildStage.Assemble];
const REUSE = [BuildStage.Layout, BuildStage.Assemble];

describe('buildStageTail', () => {
  it('says nothing between builds', () => {
    expect(buildStageTail(null)).toBeNull();
  });

  it('names the stage and its place in the plan', () => {
    expect(buildStageTail({ stages: FULL, index: 1, percent: null })).toBe('packing layout 2/3');
  });

  it('counts against the stages THIS build runs, not a constant', () => {
    // The same stage, one apply reusing the packed layout and skipping the
    // atlas: it is the first of two here, the second of three above.
    expect(buildStageTail({ stages: REUSE, index: 0, percent: null })).toBe('packing layout 1/2');
  });

  it('leads with the percent where a stage can measure itself', () => {
    expect(buildStageTail({ stages: FULL, index: 1, percent: 43 })).toBe(
      'packing layout 43% (2/3)'
    );
  });

  it('has a label for every stage', () => {
    for (const [index] of FULL.entries()) {
      expect(buildStageTail({ stages: FULL, index, percent: null })).toMatch(/^[a-z].+ \d\/3$/);
    }
  });
});
