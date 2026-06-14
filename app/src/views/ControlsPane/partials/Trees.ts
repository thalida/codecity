// views/ControlsPane/partials/Trees.ts — Trees section declaration: where
// each TREES field sits in the Settings panel. Field metadata
// (kind/label/tip/bounds/default) lives with the store; this is arrangement only.

import { field, type SectionNode } from '.';
import { TREES } from '@/state/stores/settings/trees';

export const TREES_SECTION: SectionNode = {
  key: 'trees',
  label: 'Trees',
  description:
    'One tree per commit — height tracks age, width tracks file count, color tracks commits-per-day (same-day commits share a color).',
  children: [
    { key: 'visibility', label: 'Visibility', children: [field(TREES, 'ENABLED')] },
    {
      key: 'color',
      label: 'Color by commits-per-day',
      children: [
        field(TREES, 'COLOR_BUSY_DAY'),
        field(TREES, 'COLOR_SOLO_DAY'),
        field(TREES, 'TRUNK_COLOR'),
        field(TREES, 'SHADING_STRENGTH'),
      ],
    },
    {
      key: 'height',
      label: 'Height by age',
      children: [
        field(TREES, 'MIN_HEIGHT'),
        field(TREES, 'MAX_HEIGHT'),
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
      key: 'outlines',
      label: 'Outlines',
      children: [
        field(TREES, 'OUTLINE_WIDTH'),
        field(TREES, 'OUTLINE_HOVER_COLOR'),
        field(TREES, 'OUTLINE_HOVER_OPACITY'),
        field(TREES, 'OUTLINE_SELECTED_OPACITY'),
      ],
    },
  ],
};
