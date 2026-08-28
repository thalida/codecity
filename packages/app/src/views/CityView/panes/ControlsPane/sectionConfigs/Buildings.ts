// views/ControlsPane/sections/Buildings.ts — per-file boxes. Hover/selected
// states and the enter transition live under Interaction, matching Streets
// and Trees.
import { CITY_STORES } from '@/state/settings/values/city';
import { field } from '@/utils/field';
import type { SectionNode } from '@/types/controls';

// One selection-fade tier subgroup (DEFAULT / LEVEL1..4).
function fadeTier(label: string, prefix: 'DEFAULT' | 'LEVEL1' | 'LEVEL2' | 'LEVEL3' | 'LEVEL4') {
  return {
    key: `fade-${prefix.toLowerCase()}`,
    label,
    children: [
      field(CITY_STORES.BUILDINGS, `${prefix}_DETAIL`),
      field(CITY_STORES.BUILDINGS, `${prefix}_OUTLINE`),
      field(CITY_STORES.BUILDINGS, `${prefix}_BODY_OPACITY`),
      field(CITY_STORES.BUILDINGS, `${prefix}_OUTLINE_OPACITY`),
    ],
  };
}

export const BUILDINGS_SECTION: SectionNode = {
  key: 'buildings',
  label: 'Buildings',
  description:
    'Per-file boxes: height from line count, width from byte size, color from extension + age.',
  children: [
    {
      key: 'buildings-size',
      label: 'Size',
      children: [
        field(CITY_STORES.BUILDING_DIMENSIONS, 'MIN_FLOORS'),
        field(CITY_STORES.BUILDING_DIMENSIONS, 'MAX_FLOORS'),
        field(CITY_STORES.BUILDING_DIMENSIONS, 'FULL_HEIGHT_LINES'),
        field(CITY_STORES.BUILDING_DIMENSIONS, 'FLOOR_HEIGHT'),
        field(CITY_STORES.BUILDING_DIMENSIONS, 'EMPTY_SLAB_FLOORS'),
        field(CITY_STORES.BUILDING_DIMENSIONS, 'MIN_WIDTH'),
        field(CITY_STORES.BUILDING_DIMENSIONS, 'MAX_WIDTH'),
        field(CITY_STORES.BUILDING_DIMENSIONS, 'FULL_WIDTH_KB'),
        field(CITY_STORES.BUILDING_DIMENSIONS, 'DISTANCE_FROM_ROAD'),
      ],
    },
    {
      key: 'buildings-color',
      label: 'Color by Age',
      children: [
        field(CITY_STORES.BUILDINGS, 'HALF_LIFE_DAYS'),
        field(CITY_STORES.BUILDINGS, 'SATURATION_MIN'),
        field(CITY_STORES.BUILDINGS, 'SATURATION_MAX'),
        field(CITY_STORES.BUILDINGS, 'LIGHTNESS_MIN'),
        field(CITY_STORES.BUILDINGS, 'LIGHTNESS_MAX'),
      ],
    },
    {
      key: 'hues',
      label: 'Extension Hues (0–359°)',
      children: [field(CITY_STORES.BUILDINGS, 'HUE_EXT_MAP')],
    },
    {
      key: 'facade',
      label: 'Facade',
      children: [
        {
          key: 'facade-geometry',
          label: 'Geometry',
          children: [
            field(CITY_STORES.BUILDINGS, 'SLAB_HEIGHT_FRAC'),
            field(CITY_STORES.BUILDINGS, 'WINDOW_WIDTH_FRAC'),
            field(CITY_STORES.BUILDINGS, 'WINDOW_HEIGHT_FRAC'),
            field(CITY_STORES.BUILDINGS, 'WINDOW_MARGIN_FRAC'),
            field(CITY_STORES.BUILDINGS, 'DOOR_HEIGHT_FRAC'),
            field(CITY_STORES.BUILDINGS, 'ROOF_BORDER_FRAC'),
            field(CITY_STORES.BUILDINGS, 'WINDOW_COLS_MAX'),
            field(CITY_STORES.BUILDINGS, 'WIDTH_PER_WINDOW_COL'),
            field(CITY_STORES.BUILDINGS, 'DOOR_WIDTH_FRAC'),
          ],
        },
        {
          key: 'facade-contrast',
          label: 'Contrast (HSL Lightness Δ)',
          children: [
            field(CITY_STORES.BUILDINGS, 'SLAB_LIGHTNESS_DELTA'),
            field(CITY_STORES.BUILDINGS, 'DOOR_LIGHTNESS_DELTA'),
          ],
        },
        {
          key: 'facade-windows',
          label: 'Window Lighting',
          children: [
            field(CITY_STORES.BUILDINGS, 'UNLIT_LIGHTNESS_DELTA'),
            field(CITY_STORES.BUILDINGS, 'GAP_BASE_THRESHOLD'),
            field(CITY_STORES.BUILDINGS, 'GAP_AGE_BONUS'),
            field(CITY_STORES.BUILDINGS, 'LIT_FRESHNESS_EXPONENT'),
            field(CITY_STORES.BUILDINGS, 'DIM_GLOW_COLOR'),
            field(CITY_STORES.BUILDINGS, 'WINDOW_EMISSION'),
          ],
        },
        {
          key: 'facade-ads',
          label: 'Billboards (Media Files)',
          children: [
            field(CITY_STORES.BUILDINGS, 'MEDIA_ENABLED'),
            field(CITY_STORES.BUILDINGS, 'MEDIA_SIDE_MARGIN_FRAC'),
            field(CITY_STORES.BUILDINGS, 'MEDIA_BOTTOM_OFFSET_FLOORS'),
            field(CITY_STORES.BUILDINGS, 'MEDIA_PLACEHOLDER_COLOR'),
            field(CITY_STORES.BUILDINGS, 'MEDIA_EMISSION'),
          ],
        },
        {
          key: 'facade-data',
          label: 'Data Blocks (Binary Files)',
          children: [
            field(CITY_STORES.BUILDINGS, 'DATA_ENABLED'),
            field(CITY_STORES.BUILDING_DIMENSIONS, 'DATA_HEIGHT_RATIO'),
            field(CITY_STORES.BUILDINGS, 'DATA_COLOR'),
            field(CITY_STORES.BUILDINGS, 'DATA_EMISSION'),
          ],
        },
        {
          key: 'facade-grime',
          label: 'Grime Streaks',
          children: [
            field(CITY_STORES.BUILDINGS, 'GRIME_ENABLED'),
            field(CITY_STORES.BUILDINGS, 'GRIME_INTENSITY'),
            field(CITY_STORES.BUILDINGS, 'GRIME_COVERAGE'),
          ],
        },
      ],
    },
    {
      key: 'buildings-interaction',
      label: 'Interaction',
      children: [
        {
          key: 'outlines',
          label: 'Outlines',
          children: [
            field(CITY_STORES.BUILDINGS, 'OUTLINE_WIDTH'),
            field(CITY_STORES.BUILDINGS, 'OUTLINE_HOVER_COLOR'),
            field(CITY_STORES.BUILDINGS, 'OUTLINE_HOVER_OPACITY'),
            field(CITY_STORES.BUILDINGS, 'OUTLINE_SELECTED_OPACITY'),
          ],
        },
        {
          key: 'transitions',
          label: 'Transitions',
          children: [field(CITY_STORES.BUILDINGS, 'BUILDING_TRANSITION_MS')],
        },
        {
          key: 'selection-fade',
          label: 'Selection Fade',
          children: [
            fadeTier('Default tier — selected, hovered, or idle', 'DEFAULT'),
            fadeTier('Level 1 — same dir as selection', 'LEVEL1'),
            fadeTier('Level 2 — one dir away (up or down)', 'LEVEL2'),
            fadeTier('Level 3 — two dirs away', 'LEVEL3'),
            fadeTier('Level 4 — three or more dirs away', 'LEVEL4'),
          ],
        },
      ],
    },
  ],
};
