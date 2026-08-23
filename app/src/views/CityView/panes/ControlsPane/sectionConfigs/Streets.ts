// views/ControlsPane/sections/Streets.ts — road sizing, packing, and surface
// visuals. Hover/selected states live under Interaction, matching Buildings
// and Trees.
import { field } from '@/utils/field';
import type { SectionNode } from '@/types/controls';
import { STREETS, STREET_TIERS, STREET_LAYOUT } from '@/city/session/settings/streets';

export const STREETS_SECTION: SectionNode = {
  key: 'streets',
  label: 'Streets',
  description: 'One street per folder: width from depth, length from contents.',
  children: [
    {
      key: 'width-tiers',
      label: 'Width Tiers',
      children: [field(STREET_TIERS, 'TIERS')],
    },
    {
      key: 'spacing',
      label: 'Spacing',
      children: [
        field(STREET_LAYOUT, 'BUILDING_GAP'),
        field(STREET_LAYOUT, 'STREET_GAP'),
        field(STREET_LAYOUT, 'ROOT_END_PAD'),
        field(STREET_LAYOUT, 'PARENT_JOIN_PAD'),
      ],
    },
    {
      key: 'asphalt',
      label: 'Asphalt',
      children: [field(STREETS, 'ASPHALT_COLOR')],
    },
    {
      key: 'labels',
      label: 'Labels',
      children: [
        field(STREETS, 'LABEL_FILL'),
        field(STREETS, 'LABEL_STROKE'),
        field(STREETS, 'LABEL_STROKE_WIDTH_FRAC'),
        field(STREETS, 'LABEL_HEIGHT_FRAC'),
      ],
    },
    {
      key: 'streets-interaction',
      label: 'Interaction',
      children: [
        {
          key: 'sidewalks',
          label: 'Sidewalks',
          children: [
            field(STREETS, 'SIDEWALK_DEFAULT'),
            field(STREETS, 'SIDEWALK_HOVER'),
            field(STREETS, 'SIDEWALK_SELECTED'),
          ],
        },
        {
          key: 'path-lines',
          label: 'Path Lines',
          children: [
            field(STREETS, 'PATH_LINEWIDTH_PCT'),
            field(STREETS, 'PATH_OPACITY'),
            field(STREETS, 'HOVER_PATH_COLOR'),
            field(STREETS, 'HOVER_PATH_OPACITY'),
          ],
        },
      ],
    },
  ],
};
