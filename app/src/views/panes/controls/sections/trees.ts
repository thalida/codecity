// views/panes/controls/sections/trees.ts — Trees section declaration: where
// each TREES / TREE_OUTLINE field sits in the Settings panel. Field metadata
// (kind/label/tip/bounds/default) lives with the store; this is arrangement only.

import { field, type SectionNode } from '.';
import { TREES, TREE_OUTLINE } from '@/state/settings/components/trees';

export const TREES_SECTION: SectionNode = {
  key: 'trees',
  label: 'Trees',
  description:
    'One tree per commit — height tracks age, width + facets track file count, color tracks commits-per-day (same-day commits share a color).',
  children: [
    { key: 'visibility', label: 'Visibility', children: [field(TREES, 'TREES_ENABLED')] },
    {
      key: 'placement',
      label: 'Placement',
      children: [field(TREES, 'EDGE_INSET_PERCENT'), field(TREES, 'TREE_DENSITY_FALLOFF')],
    },
    {
      key: 'color',
      label: 'Color by commits-per-day',
      children: [
        field(TREES, 'TREE_COLOR_BUSY_DAY'),
        field(TREES, 'TREE_COLOR_SOLO_DAY'),
        field(TREES, 'TREE_TRUNK_COLOR'),
        field(TREES, 'TREE_SHADING_STRENGTH'),
      ],
    },
    {
      key: 'age-desat',
      label: 'Age desaturation',
      children: [field(TREES, 'TREE_AGE_DESAT_ENABLED'), field(TREES, 'TREE_AGE_SATURATION')],
    },
    {
      key: 'height',
      label: 'Height by age',
      children: [
        field(TREES, 'TREE_MIN_HEIGHT'),
        field(TREES, 'TREE_MAX_HEIGHT'),
        field(TREES, 'TRUNK_HEIGHT_FRAC'),
        field(TREES, 'CANOPY_TRUNK_OVERLAP_FRAC'),
      ],
    },
    {
      key: 'width',
      label: 'Width by files',
      children: [
        field(TREES, 'TREE_MIN_WIDTH'),
        field(TREES, 'TREE_MAX_WIDTH'),
        field(TREES, 'TRUNK_RADIUS_FRAC_OF_CANOPY'),
        field(TREES, 'TREE_WIDTH_AGE_FLOOR'),
      ],
    },
    {
      key: 'facets',
      label: 'Facets by files',
      children: [
        field(TREES, 'TREE_FACETS_LOW'),
        field(TREES, 'TREE_FACETS_MID'),
        field(TREES, 'TREE_FACETS_HIGH'),
      ],
    },
    {
      key: 'outlines',
      label: 'Outlines',
      children: [
        field(TREE_OUTLINE, 'WIDTH'),
        field(TREE_OUTLINE, 'HOVER_COLOR'),
        field(TREE_OUTLINE, 'HOVER_OPACITY'),
        field(TREE_OUTLINE, 'SELECTED_OPACITY'),
      ],
    },
  ],
};
