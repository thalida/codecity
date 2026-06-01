// views/controls/sections/buildings.ts — Buildings section declaration.
// Per-file boxes: height from line count, width from byte size, color from
// extension + age. The largest section — layout, transitions, palette,
// per-extension hues, outlines, facade, aging, selection fade. Subgroups are
// arrangement only; the four stores (BUILDING_DIMENSIONS, BUILDINGS, FACADE,
// BUILDING_FADE) own each field.
import { field, type SectionNode } from '.';
import { BUILDING_DIMENSIONS, BUILDINGS, FACADE, BUILDING_FADE } from '@/state/stores/settings/index';

// One selection-fade tier subgroup (DEFAULT / LEVEL1..4).
function fadeTier(label: string, prefix: 'DEFAULT' | 'LEVEL1' | 'LEVEL2' | 'LEVEL3' | 'LEVEL4') {
  return {
    key: `fade-${prefix.toLowerCase()}`,
    label,
    children: [
      field(BUILDING_FADE, `${prefix}_DETAIL`),
      field(BUILDING_FADE, `${prefix}_OUTLINE`),
      field(BUILDING_FADE, `${prefix}_BODY_OPACITY`),
      field(BUILDING_FADE, `${prefix}_OUTLINE_OPACITY`),
    ],
  };
}

export const BUILDINGS_SECTION: SectionNode = {
  key: 'buildings',
  label: 'Buildings',
  description:
    'Per-file boxes — height from line count, width from byte size, color from extension + age.',
  children: [
    {
      key: 'layout',
      label: 'Building layout',
      children: [
        field(BUILDING_DIMENSIONS, 'MIN_FLOORS'),
        field(BUILDING_DIMENSIONS, 'MAX_FLOORS'),
        field(BUILDING_DIMENSIONS, 'FLOOR_HEIGHT'),
        field(BUILDING_DIMENSIONS, 'MIN_WIDTH'),
        field(BUILDING_DIMENSIONS, 'MAX_WIDTH'),
        field(BUILDING_DIMENSIONS, 'DISTANCE_FROM_ROAD'),
      ],
    },
    {
      key: 'transitions',
      label: 'Transitions',
      children: [field(BUILDINGS, 'BUILDING_TRANSITION_MS')],
    },
    {
      key: 'palette',
      label: 'Color palette (HSL)',
      children: [
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
      key: 'facade',
      label: 'Facade',
      children: [
        {
          key: 'facade-geometry',
          label: 'Geometry',
          children: [
            field(FACADE, 'SLAB_HEIGHT_FRAC'),
            field(FACADE, 'WINDOW_WIDTH_FRAC'),
            field(FACADE, 'WINDOW_HEIGHT_FRAC'),
            field(FACADE, 'WINDOW_MARGIN_FRAC'),
            field(FACADE, 'DOOR_HEIGHT_FRAC'),
            field(FACADE, 'ROOF_BORDER_FRAC'),
            field(FACADE, 'WINDOW_COLS_MAX'),
            field(FACADE, 'WIDTH_PER_WINDOW_COL'),
            field(FACADE, 'DOOR_WIDTH_FRAC'),
          ],
        },
        {
          key: 'facade-contrast',
          label: 'Contrast (HSL lightness Δ)',
          children: [
            field(FACADE, 'SLAB_LIGHTNESS_DELTA'),
            field(FACADE, 'DOOR_LIGHTNESS_DELTA'),
            field(FACADE, 'ROOF_BORDER_LIGHTNESS_DELTA'),
          ],
        },
        {
          key: 'facade-windows',
          label: 'Window lighting',
          children: [
            field(FACADE, 'UNLIT_LIGHTNESS_DELTA'),
            field(FACADE, 'GAP_BASE_THRESHOLD'),
            field(FACADE, 'GAP_AGE_BONUS'),
            field(FACADE, 'LIT_FRESHNESS_EXPONENT'),
            field(FACADE, 'DIM_GLOW_COLOR'),
          ],
        },
        {
          key: 'facade-ads',
          label: 'Ad panels (media files)',
          children: [
            field(FACADE, 'AD_SIDE_MARGIN_FRAC'),
            field(FACADE, 'AD_BOTTOM_OFFSET_FLOORS'),
            field(FACADE, 'AD_PLACEHOLDER_COLOR'),
          ],
        },
      ],
    },
    {
      key: 'aging',
      label: 'Aging',
      children: [
        {
          key: 'aging-grime',
          label: 'Grime streaks',
          children: [
            field(BUILDINGS, 'GRIME_ENABLED'),
            field(BUILDINGS, 'GRIME_INTENSITY'),
            field(BUILDINGS, 'GRIME_COVERAGE'),
          ],
        },
        {
          key: 'aging-tilt',
          label: 'Tilt',
          children: [field(BUILDINGS, 'TILT_ENABLED'), field(BUILDINGS, 'TILT_DEGREES')],
        },
      ],
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
};
