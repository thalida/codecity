// views/ControlsPane/sections/Buildings.ts — per-file boxes. Hover/selected
// states and the enter transition live under Interaction, matching Streets
// and Trees.
import { field } from '@/utils/field';
import type { SectionNode } from '@/types/controls';
import { BUILDING_DIMENSIONS, BUILDINGS } from '@/state/settings/fields/buildings';

// One selection-fade tier subgroup (DEFAULT / LEVEL1..4).
function fadeTier(label: string, prefix: 'DEFAULT' | 'LEVEL1' | 'LEVEL2' | 'LEVEL3' | 'LEVEL4') {
  return {
    key: `fade-${prefix.toLowerCase()}`,
    label,
    children: [
      field(BUILDINGS, `${prefix}_DETAIL`),
      field(BUILDINGS, `${prefix}_OUTLINE`),
      field(BUILDINGS, `${prefix}_BODY_OPACITY`),
      field(BUILDINGS, `${prefix}_OUTLINE_OPACITY`),
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
        field(BUILDING_DIMENSIONS, 'MIN_FLOORS'),
        field(BUILDING_DIMENSIONS, 'MAX_FLOORS'),
        field(BUILDING_DIMENSIONS, 'FULL_HEIGHT_LINES'),
        field(BUILDING_DIMENSIONS, 'FLOOR_HEIGHT'),
        field(BUILDING_DIMENSIONS, 'EMPTY_SLAB_FLOORS'),
        field(BUILDING_DIMENSIONS, 'MIN_WIDTH'),
        field(BUILDING_DIMENSIONS, 'MAX_WIDTH'),
        field(BUILDING_DIMENSIONS, 'FULL_WIDTH_KB'),
        field(BUILDING_DIMENSIONS, 'DISTANCE_FROM_ROAD'),
      ],
    },
    {
      key: 'buildings-color',
      label: 'Color by age',
      children: [
        field(BUILDINGS, 'HALF_LIFE_DAYS'),
        field(BUILDINGS, 'SATURATION_MIN'),
        field(BUILDINGS, 'SATURATION_MAX'),
        field(BUILDINGS, 'LIGHTNESS_MIN'),
        field(BUILDINGS, 'LIGHTNESS_MAX'),
      ],
    },
    {
      key: 'hues',
      label: 'Extension hues (0–359°)',
      children: [field(BUILDINGS, 'HUE_EXT_MAP')],
    },
    {
      key: 'facade',
      label: 'Facade',
      children: [
        {
          key: 'facade-geometry',
          label: 'Geometry',
          children: [
            field(BUILDINGS, 'SLAB_HEIGHT_FRAC'),
            field(BUILDINGS, 'WINDOW_WIDTH_FRAC'),
            field(BUILDINGS, 'WINDOW_HEIGHT_FRAC'),
            field(BUILDINGS, 'WINDOW_MARGIN_FRAC'),
            field(BUILDINGS, 'DOOR_HEIGHT_FRAC'),
            field(BUILDINGS, 'ROOF_BORDER_FRAC'),
            field(BUILDINGS, 'WINDOW_COLS_MAX'),
            field(BUILDINGS, 'WIDTH_PER_WINDOW_COL'),
            field(BUILDINGS, 'DOOR_WIDTH_FRAC'),
          ],
        },
        {
          key: 'facade-contrast',
          label: 'Contrast (HSL lightness Δ)',
          children: [
            field(BUILDINGS, 'SLAB_LIGHTNESS_DELTA'),
            field(BUILDINGS, 'DOOR_LIGHTNESS_DELTA'),
          ],
        },
        {
          key: 'facade-windows',
          label: 'Window lighting',
          children: [
            field(BUILDINGS, 'UNLIT_LIGHTNESS_DELTA'),
            field(BUILDINGS, 'GAP_BASE_THRESHOLD'),
            field(BUILDINGS, 'GAP_AGE_BONUS'),
            field(BUILDINGS, 'LIT_FRESHNESS_EXPONENT'),
            field(BUILDINGS, 'DIM_GLOW_COLOR'),
            field(BUILDINGS, 'WINDOW_EMISSION'),
          ],
        },
        {
          key: 'facade-ads',
          label: 'Billboards (media files)',
          children: [
            field(BUILDINGS, 'MEDIA_ENABLED'),
            field(BUILDINGS, 'MEDIA_SIDE_MARGIN_FRAC'),
            field(BUILDINGS, 'MEDIA_BOTTOM_OFFSET_FLOORS'),
            field(BUILDINGS, 'MEDIA_PLACEHOLDER_COLOR'),
            field(BUILDINGS, 'MEDIA_EMISSION'),
          ],
        },
        {
          key: 'facade-data',
          label: 'Data blocks (binary files)',
          children: [
            field(BUILDINGS, 'DATA_ENABLED'),
            field(BUILDING_DIMENSIONS, 'DATA_HEIGHT_RATIO'),
            field(BUILDINGS, 'DATA_COLOR'),
            field(BUILDINGS, 'DATA_EMISSION'),
          ],
        },
        {
          key: 'facade-grime',
          label: 'Grime streaks',
          children: [
            field(BUILDINGS, 'GRIME_ENABLED'),
            field(BUILDINGS, 'GRIME_INTENSITY'),
            field(BUILDINGS, 'GRIME_COVERAGE'),
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
            field(BUILDINGS, 'OUTLINE_WIDTH'),
            field(BUILDINGS, 'OUTLINE_HOVER_COLOR'),
            field(BUILDINGS, 'OUTLINE_HOVER_OPACITY'),
            field(BUILDINGS, 'OUTLINE_SELECTED_OPACITY'),
          ],
        },
        {
          key: 'transitions',
          label: 'Transitions',
          children: [field(BUILDINGS, 'BUILDING_TRANSITION_MS')],
        },
        {
          key: 'selection-fade',
          label: 'Selection fade',
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
