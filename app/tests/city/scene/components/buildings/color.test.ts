import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getHue,
  extHueColor,
  modifiedRecency,
  getBuildingColor,
  getBuildingColorForRecency,
  getModifiedAge,
} from '@/city/scene/components/buildings/color';
import { BUILDINGS } from '@/city/session/settings/buildings';
import type { BuildingsConfig } from '@/city/session/settings/buildings';
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
    MODIFIED_HALF_LIFE_DAYS: 30,
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

// Saturation and lightness share one curve over the recency scale, so the curve
// is exercised once through the colour string rather than twice per channel.
const OLDEST = '2024-01-01T00:00:00Z';
const NEWEST = '2024-03-01T00:00:00Z';
const MIDPOINT = '2024-01-31T00:00:00Z'; // exactly half of a 60-day leap-year span
const DAY = 86_400_000;
const NOW = Date.parse(NEWEST);
const at = (modified: string | null) => ({ type: NodeKind.File, extension: '.ts', modified });

describe('getBuildingColorForRecency', () => {
  it.each([
    ['floor', 0, 'hsl(215, 20%, 25%)'],
    ['midpoint', 0.5, 'hsl(215, 60%, 48%)'],
    ['ceiling', 1, 'hsl(215, 100%, 70%)'],
  ])('drives both channels off one t (%s)', (_label, t, expected) => {
    expect(
      getBuildingColorForRecency({ type: NodeKind.File, extension: '.ts' }, t, BUILDINGS.value)
    ).toBe(expected);
  });

  it('clamps a t outside the range rather than overshooting the bounds', () => {
    const f = { type: NodeKind.File, extension: '.ts' };
    expect(getBuildingColorForRecency(f, -1, BUILDINGS.value)).toBe(
      getBuildingColorForRecency(f, 0, BUILDINGS.value)
    );
    expect(getBuildingColorForRecency(f, 2, BUILDINGS.value)).toBe(
      getBuildingColorForRecency(f, 1, BUILDINGS.value)
    );
  });
});

describe('modifiedRecency', () => {
  it.each([
    ['dated now', 0, 1],
    ['at the half-life', 30, 0.5],
    ['a year old', 365, 30 / 395],
  ])('%s', (_label, days, expected) => {
    expect(
      modifiedRecency(at(new Date(NOW - days * DAY).toISOString()), NOW, BUILDINGS.value)
    ).toBeCloseTo(expected, 6);
  });

  it('takes the midpoint when the file has no date', () => {
    expect(modifiedRecency(at(null), NOW, BUILDINGS.value)).toBe(0.5);
  });

  it('depends on nothing but its own age, so one edit cannot restate another file', () => {
    const f = at(MIDPOINT);
    expect(modifiedRecency(f, NOW, BUILDINGS.value)).toBe(modifiedRecency(f, NOW, BUILDINGS.value));
  });

  it('stretches with the half-life instead of clipping at a horizon', () => {
    BUILDINGS.value = { ...BUILDINGS.value, MODIFIED_HALF_LIFE_DAYS: 365 };
    const long = modifiedRecency(at(OLDEST), NOW, BUILDINGS.value);
    BUILDINGS.value = { ...BUILDINGS.value, MODIFIED_HALF_LIFE_DAYS: 30 };
    expect(long).toBeGreaterThan(modifiedRecency(at(OLDEST), NOW, BUILDINGS.value));
  });

  it('keeps a year and a decade apart, where a horizon would flatten both', () => {
    const year = modifiedRecency(at(new Date(NOW - 365 * DAY).toISOString()), NOW, BUILDINGS.value);
    const decade = modifiedRecency(
      at(new Date(NOW - 3650 * DAY).toISOString()),
      NOW,
      BUILDINGS.value
    );
    expect(decade).toBeGreaterThan(0);
    expect(year / decade).toBeGreaterThan(3);
  });
});

describe('getModifiedAge', () => {
  it('is the colour axis inverted, so Live and Timeline cannot drift', () => {
    const f = at(MIDPOINT);
    expect(getModifiedAge(f, NOW, BUILDINGS.value)).toBeCloseTo(
      1 - modifiedRecency(f, NOW, BUILDINGS.value),
      10
    );
  });
});

describe('getBuildingColor', () => {
  const file = (extension: string, modified: string) => ({
    name: `f${extension}`,
    type: NodeKind.File,
    extension,
    modified,
  });

  it('sends a file touched now to both range ceilings', () => {
    expect(getBuildingColor(file('.ts', NEWEST), NOW, BUILDINGS.value)).toBe('hsl(215, 100%, 70%)');
  });

  it('walks both channels down together as a file ages', () => {
    const old = getBuildingColor(
      file('.ts', new Date(NOW - 3650 * DAY).toISOString()),
      NOW,
      BUILDINGS.value
    );
    expect(old).toBe('hsl(215, 21%, 25%)');
  });

  it.each([
    ['.md', 275],
    ['.xyz', XYZ_HUE],
  ])('takes the hue from the extension (%s)', (ext, hue) => {
    expect(getBuildingColor(file(ext, NEWEST), NOW, BUILDINGS.value)).toBe(
      `hsl(${hue}, 100%, 70%)`
    );
  });
});
