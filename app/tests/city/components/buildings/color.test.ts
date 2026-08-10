import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getHue,
  extHueColor,
  getSaturation,
  getLightness,
  getBuildingColor,
  getModifiedAge,
} from '@/city/components/buildings/color';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import type { BuildingsConfig } from '@/state/stores/settings/buildings';
import { NodeKind } from '@/types';
import type { RangeStat } from '@/types';

// Test palette + saturation/lightness ranges. Mutated into the
// BUILDINGS store by beforeEach; restored by afterEach.
const TEST_HUE_EXT_MAP: Record<string, number> = {
  '.ts': 215,
  '.js': 220,
  '.md': 275,
  '.json': 50,
  '.png': 30,
};
const TEST_SAT_RANGE: RangeStat = { min: 20, max: 100 };
const TEST_LIGHT_RANGE: RangeStat = { min: 25, max: 70 };

// getHue's fallback hash for an extension outside the palette.
const XYZ_HUE = 259;

let _origPalette: BuildingsConfig | null = null;
beforeEach(() => {
  _origPalette = { ...BUILDINGS.value };
  BUILDINGS.value = {
    ...BUILDINGS.value,
    HUE_EXT_MAP: TEST_HUE_EXT_MAP,
    SATURATION_MIN: TEST_SAT_RANGE.min,
    SATURATION_MAX: TEST_SAT_RANGE.max,
    LIGHTNESS_MIN: TEST_LIGHT_RANGE.min,
    LIGHTNESS_MAX: TEST_LIGHT_RANGE.max,
  };
});
afterEach(() => {
  if (!_origPalette) return;
  BUILDINGS.value = _origPalette;
});

describe('getHue', () => {
  it.each(Object.entries(TEST_HUE_EXT_MAP))('reads %s straight off the palette', (ext, hue) => {
    expect(getHue(ext, TEST_HUE_EXT_MAP)).toBe(hue);
  });

  it('hashes an extension the palette does not carry', () => {
    expect(getHue('.xyz', TEST_HUE_EXT_MAP)).toBe(XYZ_HUE);
  });

  it('hues an extensionless file off the empty string', () => {
    expect(getHue('', TEST_HUE_EXT_MAP)).toBe(0);
  });
});

describe('extHueColor', () => {
  it.each([
    ['.ts', 'hsl(215, 60%, 35%)'],
    ['.xyz', `hsl(${XYZ_HUE}, 60%, 35%)`],
    [null, 'hsl(0, 60%, 35%)'],
  ])('paints %s at the badge saturation/lightness', (ext, expected) => {
    expect(extHueColor(ext, TEST_HUE_EXT_MAP)).toBe(expected);
  });
});

// Saturation and lightness share one curve (lerpRange) over the same
// last-modified axis, so they get the same table with different bounds.
const OLDEST = '2024-01-01T00:00:00Z';
const NEWEST = '2024-03-01T00:00:00Z';
const MIDPOINT = '2024-01-31T00:00:00Z'; // exactly half of a 60-day leap-year span

describe.each([
  ['getSaturation', getSaturation, TEST_SAT_RANGE, { min: 20, mid: 60, max: 100 }],
  ['getLightness', getLightness, TEST_LIGHT_RANGE, { min: 25, mid: 48, max: 70 }],
])('%s', (_name, fn, cfg, expected) => {
  it('lands on the range floor at the oldest date', () => {
    expect(fn(OLDEST, OLDEST, NEWEST, cfg)).toBe(expected.min);
  });

  it('lands on the range ceiling at the newest date', () => {
    expect(fn(NEWEST, OLDEST, NEWEST, cfg)).toBe(expected.max);
  });

  it('interpolates linearly in between', () => {
    expect(fn(MIDPOINT, OLDEST, NEWEST, cfg)).toBe(expected.mid);
  });

  it('falls back to the range midpoint when the file has no date', () => {
    expect(fn(null, OLDEST, NEWEST, cfg)).toBe(expected.mid);
  });

  it('treats a degenerate range as freshest rather than dividing by zero', () => {
    expect(fn(OLDEST, OLDEST, OLDEST, cfg)).toBe(expected.max);
  });
});

describe('getBuildingColor', () => {
  // Saturation and lightness anchor on the MODIFIED range, not created. This
  // fixture separates the two: maxModified sits strictly inside the created
  // range, so anchoring on created would land b.ts at t≈0.7 instead of 1.0.
  const RANGES = {
    minCreated: '2020-01-01T00:00:00Z',
    maxCreated: '2024-12-31T00:00:00Z',
    minModified: '2022-01-01T00:00:00Z',
    maxModified: '2023-06-01T00:00:00Z',
  };
  const file = (extension: string, created: string, modified: string) => ({
    name: `f${extension}`,
    type: NodeKind.File,
    extension,
    created,
    modified,
  });
  const stalest = file('.ts', '2020-01-01T00:00:00Z', RANGES.minModified);
  const freshest = file('.ts', '2024-12-31T00:00:00Z', RANGES.maxModified);

  it('sends the least recently modified file to both range floors', () => {
    expect(getBuildingColor(stalest, RANGES)).toBe('hsl(215, 20%, 25%)');
  });

  it('sends the most recently modified file to both range ceilings', () => {
    expect(getBuildingColor(freshest, RANGES)).toBe('hsl(215, 100%, 70%)');
  });

  it.each([
    ['.md', 275],
    ['.xyz', XYZ_HUE],
  ])('takes the hue from the extension (%s)', (ext, hue) => {
    const f = file(ext, '2024-12-31T00:00:00Z', RANGES.maxModified);
    expect(getBuildingColor(f, RANGES)).toBe(`hsl(${hue}, 100%, 70%)`);
  });
});

describe('getModifiedAge', () => {
  const RANGES = {
    minCreated: '2024-01-01T00:00:00Z',
    maxCreated: '2024-12-31T00:00:00Z',
    minModified: '2024-01-10T09:00:00Z',
    maxModified: '2024-03-22T14:30:00Z',
  };
  const at = (modified: string | null) => ({
    type: NodeKind.File,
    created: '2024-01-01T00:00:00Z',
    modified,
  });

  // Polarity is inverted against the date axis: 1.0 = stalest, 0.0 = freshest.
  it.each([
    ['the earliest modification in the repo', RANGES.minModified, 1],
    ['the latest modification in the repo', RANGES.maxModified, 0],
    ['the exact midpoint of the range', '2024-02-15T11:45:00Z', 0.5],
    ['a date before the range', '2023-01-01T00:00:00Z', 1],
    ['a date after the range', '2025-01-01T00:00:00Z', 0],
  ])('scores %s at %s -> %s', (_label, modified, expected) => {
    expect(getModifiedAge(at(modified), RANGES)).toBe(expected);
  });

  it('scores a file with no modified date at the midpoint', () => {
    expect(getModifiedAge({ type: NodeKind.File }, RANGES)).toBe(0.5);
  });

  it('scores a degenerate range as freshest', () => {
    const degenerate = { ...RANGES, maxModified: RANGES.minModified };
    expect(getModifiedAge(at(RANGES.minModified), degenerate)).toBe(0);
  });
});
