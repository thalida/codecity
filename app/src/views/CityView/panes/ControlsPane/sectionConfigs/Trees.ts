// views/ControlsPane/sections/Trees.ts — one tree per commit.
import { field } from '@/utils/field';
import type { SectionNode } from '@/types/controls';
import { TREES } from '@/state/stores/settings/trees';

export const TREES_SECTION: SectionNode = {
  key: 'trees',
  label: 'Trees',
  description:
    'One tree per commit: height tracks age, width tracks file count, color tracks commits-per-day.',
  children: [
    field(TREES, 'ENABLED'),
    {
      key: 'placement',
      label: 'Placement',
      children: [
        field(TREES, 'CITY_CLEARANCE_PERCENT'),
        field(TREES, 'CITY_CLEARANCE_LIMITS'),
        field(TREES, 'DENSITY_FALLOFF'),
        field(TREES, 'EDGE_INSET_PERCENT'),
        field(TREES, 'EDGE_INSET_LIMITS'),
      ],
    },
    {
      key: 'height',
      label: 'Height by age',
      children: [
        field(TREES, 'MIN_HEIGHT'),
        field(TREES, 'MAX_HEIGHT'),
        field(TREES, 'HALF_LIFE_DAYS'),
        field(TREES, 'TRUNK_HEIGHT_FRAC'),
        field(TREES, 'CANOPY_TRUNK_OVERLAP_FRAC'),
      ],
    },
    {
      key: 'width',
      label: 'Width by files',
      children: [
        field(TREES, 'MIN_WIDTH'),
        field(TREES, 'MAX_WIDTH'),
        field(TREES, 'TRUNK_RADIUS_FRAC'),
        field(TREES, 'WIDTH_AGE_FLOOR'),
      ],
    },
    {
      key: 'trees-color',
      label: 'Color by commits-per-day',
      children: [
        field(TREES, 'COLOR_BUSY_DAY'),
        field(TREES, 'COLOR_SOLO_DAY'),
        field(TREES, 'TRUNK_COLOR'),
        field(TREES, 'SHADING_STRENGTH'),
      ],
    },
    {
      key: 'trees-interaction',
      label: 'Interaction',
      children: [
        field(TREES, 'OUTLINE_WIDTH'),
        field(TREES, 'OUTLINE_HOVER_COLOR'),
        field(TREES, 'OUTLINE_HOVER_OPACITY'),
        field(TREES, 'OUTLINE_SELECTED_OPACITY'),
      ],
    },
  ],
};
