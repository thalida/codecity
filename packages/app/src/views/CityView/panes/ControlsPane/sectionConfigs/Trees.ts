// views/ControlsPane/sections/Trees.ts — one tree per commit.
import { CITY_STORES } from '@/state/settings/values/city';
import { field } from '@/views/CityView/field';
import type { SectionNode } from '@/views/CityView/panes/ControlsPane/types';

export const TREES_SECTION: SectionNode = {
  key: 'trees',
  label: 'Trees',
  description:
    'One tree per commit: height tracks age, width tracks file count, color tracks commits-per-day.',
  children: [
    field(CITY_STORES.TREES, 'ENABLED'),
    {
      key: 'placement',
      label: 'Placement',
      children: [
        field(CITY_STORES.TREES, 'CITY_CLEARANCE_PERCENT'),
        field(CITY_STORES.TREES, 'CITY_CLEARANCE_LIMITS'),
        field(CITY_STORES.TREES, 'DENSITY_FALLOFF'),
        field(CITY_STORES.TREES, 'EDGE_INSET_PERCENT'),
        field(CITY_STORES.TREES, 'EDGE_INSET_LIMITS'),
      ],
    },
    {
      key: 'height',
      label: 'Height by Age',
      children: [
        field(CITY_STORES.TREES, 'MIN_HEIGHT'),
        field(CITY_STORES.TREES, 'MAX_HEIGHT'),
        field(CITY_STORES.TREES, 'HALF_LIFE_DAYS'),
        field(CITY_STORES.TREES, 'TRUNK_HEIGHT_FRAC'),
        field(CITY_STORES.TREES, 'CANOPY_TRUNK_OVERLAP_FRAC'),
      ],
    },
    {
      key: 'width',
      label: 'Width by Files',
      children: [
        field(CITY_STORES.TREES, 'MIN_WIDTH'),
        field(CITY_STORES.TREES, 'MAX_WIDTH'),
        field(CITY_STORES.TREES, 'TRUNK_RADIUS_FRAC'),
        field(CITY_STORES.TREES, 'WIDTH_AGE_FLOOR'),
      ],
    },
    {
      key: 'trees-color',
      label: 'Color by Commits-per-Day',
      children: [
        field(CITY_STORES.TREES, 'COLOR_BUSY_DAY'),
        field(CITY_STORES.TREES, 'COLOR_SOLO_DAY'),
        field(CITY_STORES.TREES, 'TRUNK_COLOR'),
        field(CITY_STORES.TREES, 'SHADING_STRENGTH'),
      ],
    },
    {
      key: 'trees-interaction',
      label: 'Interaction',
      children: [
        field(CITY_STORES.TREES, 'OUTLINE_WIDTH'),
        field(CITY_STORES.TREES, 'OUTLINE_HOVER_COLOR'),
        field(CITY_STORES.TREES, 'OUTLINE_HOVER_OPACITY'),
        field(CITY_STORES.TREES, 'OUTLINE_SELECTED_OPACITY'),
      ],
    },
  ],
};
