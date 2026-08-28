// The tail the "Building city" row renders. The number is the city's — it
// counts against the plan THIS build runs — and this is the word beside it.

import { describe, it, expect } from 'vitest';
import { BuildStage, buildStageTail } from '@/constants/progress';
import { EMPTY_CITY_STATUS, CityPhase, type CityStatus } from '@codecity/city';

const building = (fraction: number | null, stage: BuildStage | null): CityStatus => ({
  ...EMPTY_CITY_STATUS,
  phase: CityPhase.Building,
  stage,
  fraction,
});

describe('buildStageTail', () => {
  it('says nothing between builds', () => {
    expect(buildStageTail(EMPTY_CITY_STATUS)).toBeNull();
  });

  it('renders the city’s fraction as a percent, and names the part', () => {
    expect(buildStageTail(building(0.33, BuildStage.Layout))).toBe('33% layout');
  });

  it('has a word for every stage a build can be in', () => {
    for (const stage of Object.values(BuildStage)) {
      expect(buildStageTail(building(0.5, stage))).toMatch(/^50% [a-z]+$/);
    }
  });

  // A build that has not said which part it is in still has a number.
  it('falls back to the percent alone when no stage is named', () => {
    expect(buildStageTail(building(0.5, null))).toBe('50%');
  });
});
