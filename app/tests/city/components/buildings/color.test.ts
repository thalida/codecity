import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getHue,
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

const TEST_TREE = {
  name: 'project',
  type: NodeKind.Directory,
  path: '.',
  fullPath: '/tmp/project',
  children_count: 3,
  children_file_count: 2,
  children_dir_count: 1,
  descendants_count: 4,
  descendants_file_count: 3,
  descendants_dir_count: 1,
  descendants_size: 5000,
  children: [
    {
      name: 'index.ts',
      type: NodeKind.File,
      path: 'index.ts',
      fullPath: '/tmp/project/index.ts',
      extension: '.ts',
      size: 2000,
      lines: 80,
      binary: false,
      created: '2024-01-10T09:00:00Z',
      modified: '2024-03-22T14:30:00Z',
    },
    {
      name: 'README.md',
      type: NodeKind.File,
      path: 'README.md',
      fullPath: '/tmp/project/README.md',
      extension: '.md',
      size: 500,
      lines: 20,
      binary: false,
      created: '2024-01-10T09:00:00Z',
      modified: '2024-01-10T09:00:00Z',
    },
    {
      name: 'src',
      type: NodeKind.Directory,
      path: 'src',
      fullPath: '/tmp/project/src',
      children_count: 1,
      children_file_count: 1,
      children_dir_count: 0,
      descendants_count: 1,
      descendants_file_count: 1,
      descendants_dir_count: 0,
      descendants_size: 800,
      children: [
        {
          name: 'utils.ts',
          type: NodeKind.File,
          path: 'src/utils.ts',
          fullPath: '/tmp/project/src/utils.ts',
          extension: '.ts',
          size: 800,
          lines: 30,
          binary: false,
          created: '2024-02-15T10:00:00Z',
          modified: '2024-03-20T12:00:00Z',
        },
      ],
    },
  ],
};

// ---- getHue ----
describe('getHue', () => {
  it('returns palette value for known extension .ts', () => {
    expect(getHue('.ts', TEST_HUE_EXT_MAP)).toBe(215);
  });

  it('returns palette value for known extension .js', () => {
    expect(getHue('.js', TEST_HUE_EXT_MAP)).toBe(220);
  });

  it('returns palette value for known extension .md', () => {
    expect(getHue('.md', TEST_HUE_EXT_MAP)).toBe(275);
  });

  it('returns palette value for known extension .json', () => {
    expect(getHue('.json', TEST_HUE_EXT_MAP)).toBe(50);
  });

  it('returns palette value for known extension .png', () => {
    expect(getHue('.png', TEST_HUE_EXT_MAP)).toBe(30);
  });

  it('returns deterministic hash for unknown extension', () => {
    const hue1 = getHue('.xyz', TEST_HUE_EXT_MAP);
    const hue2 = getHue('.xyz', TEST_HUE_EXT_MAP);
    expect(hue1).toBe(hue2);
    expect(hue1).toBeGreaterThanOrEqual(0);
    expect(hue1).toBeLessThanOrEqual(359);
  });

  it('does not crash on empty extension', () => {
    const hue = getHue('', TEST_HUE_EXT_MAP);
    expect(typeof hue).toBe('number');
  });
});

// ---- getSaturation ----
describe('getSaturation', () => {
  const cfg = TEST_SAT_RANGE;

  it('returns min saturation for oldest file', () => {
    expect(
      getSaturation('2024-01-10T09:00:00Z', '2024-01-10T09:00:00Z', '2024-02-15T10:00:00Z', cfg)
    ).toBe(20);
  });

  it('returns max saturation for newest file', () => {
    expect(
      getSaturation('2024-02-15T10:00:00Z', '2024-01-10T09:00:00Z', '2024-02-15T10:00:00Z', cfg)
    ).toBe(100);
  });

  it('interpolates linearly for midpoint', () => {
    // t = 0.5 => 20 + 0.5 * 80 = 60
    const minDate = '2024-01-01T00:00:00Z';
    const maxDate = '2024-03-01T00:00:00Z';
    const midDate = '2024-01-31T00:00:00Z'; // ~halfway
    const sat = getSaturation(midDate, minDate, maxDate, cfg);
    expect(sat).toBeGreaterThan(cfg.min);
    expect(sat).toBeLessThan(cfg.max);
  });

  it('returns midpoint of the saturation range for null date', () => {
    const midpoint = Math.round((cfg.min + cfg.max) / 2);
    expect(getSaturation(null, '2024-01-10T09:00:00Z', '2024-02-15T10:00:00Z', cfg)).toBe(midpoint);
  });

  it('returns max for degenerate range', () => {
    expect(
      getSaturation('2024-01-10T09:00:00Z', '2024-01-10T09:00:00Z', '2024-01-10T09:00:00Z', cfg)
    ).toBe(100);
  });
});

// ---- getLightness ----
describe('getLightness', () => {
  const cfg = TEST_LIGHT_RANGE;

  it('returns max lightness for most recently modified', () => {
    expect(
      getLightness('2024-03-22T14:30:00Z', '2024-01-10T09:00:00Z', '2024-03-22T14:30:00Z', cfg)
    ).toBe(70);
  });

  it('returns min lightness for longest untouched', () => {
    expect(
      getLightness('2024-01-10T09:00:00Z', '2024-01-10T09:00:00Z', '2024-03-22T14:30:00Z', cfg)
    ).toBe(25);
  });

  it('interpolates linearly for midpoint', () => {
    const minDate = '2024-01-01T00:00:00Z';
    const maxDate = '2024-03-01T00:00:00Z';
    const midDate = '2024-01-31T00:00:00Z';
    const l = getLightness(midDate, minDate, maxDate, cfg);
    expect(l).toBeGreaterThan(cfg.min);
    expect(l).toBeLessThan(cfg.max);
  });

  it('returns midpoint of the lightness range for null date', () => {
    const midpoint = Math.round((cfg.min + cfg.max) / 2);
    expect(getLightness(null, '2024-01-10T09:00:00Z', '2024-03-22T14:30:00Z', cfg)).toBe(midpoint);
  });

  it('returns max for degenerate range', () => {
    expect(
      getLightness('2024-01-10T09:00:00Z', '2024-01-10T09:00:00Z', '2024-01-10T09:00:00Z', cfg)
    ).toBe(70);
  });
});

// ---- getBuildingColor ----
describe('getBuildingColor', () => {
  // Hand-written min/max of TEST_TREE's created/modified dates — what the
  // backend would ship as Manifest.dateRanges for that tree (the client
  // tree walk moved server-side; see api/services/scan.py).
  const TEST_TREE_DATE_RANGES = {
    createdMin: '2024-01-10T09:00:00Z',
    createdMax: '2024-02-15T10:00:00Z',
    modifiedMin: '2024-01-10T09:00:00Z',
    modifiedMax: '2024-03-22T14:30:00Z',
  };

  it('returns valid "hsl(...)" string', () => {
    const color = getBuildingColor(TEST_TREE.children[0], TEST_TREE_DATE_RANGES);
    expect(color).toMatch(/^hsl\(\d+,\s*[\d.]+%,\s*[\d.]+%\)$/);
  });

  it('uses correct hue for .ts files', () => {
    const color = getBuildingColor(TEST_TREE.children[0], TEST_TREE_DATE_RANGES);
    expect(color).toMatch(/^hsl\(215,/);
  });

  it('uses correct hue for .md files', () => {
    const color = getBuildingColor(TEST_TREE.children[1], TEST_TREE_DATE_RANGES);
    expect(color).toMatch(/^hsl\(275,/);
  });

  it('handles unknown extension', () => {
    const unknownFile = {
      name: 'foo.xyz',
      type: NodeKind.File,
      extension: '.xyz',
      size: 1000,
      lines: 10,
      created: '2024-01-10T09:00:00Z',
      modified: '2024-03-22T14:30:00Z',
    };
    const color = getBuildingColor(unknownFile, TEST_TREE_DATE_RANGES);
    expect(color).toMatch(/^hsl\(/);
  });

  it('lands at LIGHTNESS_MAX when modified date == modifiedMax', () => {
    // Fixture: modifiedMax (2023-06-01) is strictly inside the created range
    // [2020-01-01, 2024-12-31], so the created anchor normalizes it to t≈0.7
    // (L≈57) while the correct modified anchor normalizes it to t=1.0 (L=70).
    //   a.ts: created=2020-01-01 (createdMin), modified=2022-01-01 (modifiedMin)
    //   b.ts: created=2024-12-31 (createdMax), modified=2023-06-01 (modifiedMax)
    // b.ts with modified anchor: t=1.0 → S=100, L=70 ✓
    // b.ts with created anchor:  t≈0.7 → S≈76, L≈57 ✗  (proves the test fails today)
    const tree = {
      name: 'p',
      type: NodeKind.Directory,
      path: '.',
      children: [
        {
          name: 'a.ts',
          type: NodeKind.File,
          extension: '.ts',
          created: '2020-01-01T00:00:00Z',
          modified: '2022-01-01T00:00:00Z',
        },
        {
          name: 'b.ts',
          type: NodeKind.File,
          extension: '.ts',
          created: '2024-12-31T00:00:00Z',
          modified: '2023-06-01T00:00:00Z',
        },
      ],
    };
    const dr = {
      createdMin: '2020-01-01T00:00:00Z',
      createdMax: '2024-12-31T00:00:00Z',
      modifiedMin: '2022-01-01T00:00:00Z',
      modifiedMax: '2023-06-01T00:00:00Z',
    };
    // b.ts modified at modifiedMax → t=1.0 → lightness = LIGHTNESS_MAX (70 in test palette).
    const color = getBuildingColor(tree.children[1], dr);
    expect(color).toMatch(/^hsl\(215,\s*100%,\s*70%\)$/);
  });

  it('lands at LIGHTNESS_MIN when modified date == modifiedMin', () => {
    // Same fixture as above.
    // a.ts modified=2022-01-01 is modifiedMin but NOT createdMin (2020-01-01).
    // a.ts with modified anchor: t=0.0 → S=20,  L=25 ✓
    // a.ts with created anchor:  t≈0.4 → S≈52, L≈43 ✗  (proves the test fails today)
    const tree = {
      name: 'p',
      type: NodeKind.Directory,
      path: '.',
      children: [
        {
          name: 'a.ts',
          type: NodeKind.File,
          extension: '.ts',
          created: '2020-01-01T00:00:00Z',
          modified: '2022-01-01T00:00:00Z',
        },
        {
          name: 'b.ts',
          type: NodeKind.File,
          extension: '.ts',
          created: '2024-12-31T00:00:00Z',
          modified: '2023-06-01T00:00:00Z',
        },
      ],
    };
    const dr = {
      createdMin: '2020-01-01T00:00:00Z',
      createdMax: '2024-12-31T00:00:00Z',
      modifiedMin: '2022-01-01T00:00:00Z',
      modifiedMax: '2023-06-01T00:00:00Z',
    };
    // a.ts modified at modifiedMin → t=0.0 → lightness = LIGHTNESS_MIN (25 in test palette).
    const color = getBuildingColor(tree.children[0], dr);
    expect(color).toMatch(/^hsl\(215,\s*20%,\s*25%\)$/);
  });
});

// ---- getModifiedAge ----
describe('getModifiedAge', () => {
  const baseDr = {
    createdMin: '2024-01-01T00:00:00Z',
    createdMax: '2024-12-31T00:00:00Z',
    modifiedMin: '2024-01-10T09:00:00Z',
    modifiedMax: '2024-03-22T14:30:00Z',
  };

  it('returns 1.0 for file modified at modifiedMin (most stale)', () => {
    const file = {
      type: NodeKind.File,
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-10T09:00:00Z',
    };
    expect(getModifiedAge(file, baseDr)).toBe(1);
  });

  it('returns 0.0 for file modified at modifiedMax (most recent)', () => {
    const file = {
      type: NodeKind.File,
      created: '2024-01-01T00:00:00Z',
      modified: '2024-03-22T14:30:00Z',
    };
    expect(getModifiedAge(file, baseDr)).toBe(0);
  });

  it('interpolates for midpoint', () => {
    const file = {
      type: NodeKind.File,
      created: '2024-01-01T00:00:00Z',
      modified: '2024-02-15T11:45:00Z',
    };
    const age = getModifiedAge(file, baseDr);
    expect(age).toBeGreaterThan(0);
    expect(age).toBeLessThan(1);
  });

  it('returns 0.5 for file with no modified date', () => {
    const file = { type: NodeKind.File } as const;
    expect(getModifiedAge(file, baseDr)).toBe(0.5);
  });

  it('returns 0 for degenerate range (modifiedMin === modifiedMax)', () => {
    const file = {
      type: NodeKind.File,
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-10T09:00:00Z',
    };
    const degenerate = {
      createdMin: '2024-01-01T00:00:00Z',
      createdMax: '2024-12-31T00:00:00Z',
      modifiedMin: '2024-01-10T09:00:00Z',
      modifiedMax: '2024-01-10T09:00:00Z',
    };
    expect(getModifiedAge(file, degenerate)).toBe(0);
  });

  it('clamps to [0, 1] for dates outside the range', () => {
    const beforeMin = {
      type: NodeKind.File,
      created: '2023-01-01T00:00:00Z',
      modified: '2023-01-01T00:00:00Z',
    };
    const afterMax = {
      type: NodeKind.File,
      created: '2025-01-01T00:00:00Z',
      modified: '2025-01-01T00:00:00Z',
    };
    expect(getModifiedAge(beforeMin, baseDr)).toBe(1);
    expect(getModifiedAge(afterMax, baseDr)).toBe(0);
  });
});
