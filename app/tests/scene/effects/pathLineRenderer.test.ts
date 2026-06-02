import { describe, it, expect, afterEach } from 'vitest';
import { STREET_TIERS } from '@/state/stores/settings/streets';
import { computePathLinewidthPixels } from '@/scene/effects/pathLineRenderer';

// Capture the original tiers so afterEach can restore them.
const _originalTiers = STREET_TIERS.value;

afterEach(() => {
  STREET_TIERS.value = _originalTiers;
});

describe('computePathLinewidthPixels', () => {
  it('multiplies smallest street tier width by pct/100', () => {
    STREET_TIERS.value = {
      TIERS: [
        { min_descendants: 0, width: 10 },
        { min_descendants: 4, width: 4 },
        { min_descendants: 8, width: 6 },
      ],
    };
    // min width = 4; 4 * 25/100 = 1.0
    expect(computePathLinewidthPixels(25)).toBeCloseTo(1.0);
  });

  it('default 10% with smallest width 4 produces 0.4', () => {
    STREET_TIERS.value = {
      TIERS: [
        { min_descendants: 0, width: 10 },
        { min_descendants: 4, width: 4 },
      ],
    };
    expect(computePathLinewidthPixels(10)).toBeCloseTo(0.4);
  });

  it('returns pct/100 as fallback when tiers array is empty', () => {
    STREET_TIERS.value = { TIERS: [] };
    // degenerate fallback: pct / 100
    expect(computePathLinewidthPixels(50)).toBeCloseTo(0.5);
  });

  it('uses default STREET_TIERS smallest width (32) × 10% = 3.2 when no override', () => {
    // default tiers: widths 32, 48, 80, 96, 128 → min = 32
    expect(computePathLinewidthPixels(10)).toBeCloseTo(3.2);
  });
});
