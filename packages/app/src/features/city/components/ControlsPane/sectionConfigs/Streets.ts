// features/city/components/ControlsPane/sectionConfigs/Streets.ts — road sizing, packing, and surface
// visuals. Hover/selected states live under Interaction, matching Buildings
// and Trees.
import { CITY_STORES } from '@/features/settings/state/values/city';
import { field } from '@/features/city/field';
import type { SectionNode } from '@/features/city/components/ControlsPane/types';

export const STREETS_SECTION: SectionNode = {
  key: 'streets',
  label: 'Streets',
  description: 'One street per folder: width from depth, length from contents.',
  children: [
    {
      key: 'width-tiers',
      label: 'Width Tiers',
      children: [field(CITY_STORES.STREET_TIERS, 'TIERS')],
    },
    {
      key: 'spacing',
      label: 'Spacing',
      children: [
        field(CITY_STORES.STREET_LAYOUT, 'BUILDING_GAP'),
        field(CITY_STORES.STREET_LAYOUT, 'STREET_GAP'),
        field(CITY_STORES.STREET_LAYOUT, 'ROOT_END_PAD'),
        field(CITY_STORES.STREET_LAYOUT, 'PARENT_JOIN_PAD'),
      ],
    },
    {
      key: 'asphalt',
      label: 'Asphalt',
      children: [field(CITY_STORES.STREETS, 'ASPHALT_COLOR')],
    },
    {
      key: 'labels',
      label: 'Labels',
      children: [
        field(CITY_STORES.STREETS, 'LABEL_FILL'),
        field(CITY_STORES.STREETS, 'LABEL_STROKE'),
        field(CITY_STORES.STREETS, 'LABEL_STROKE_WIDTH_FRAC'),
        field(CITY_STORES.STREETS, 'LABEL_HEIGHT_FRAC'),
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
            field(CITY_STORES.STREETS, 'SIDEWALK_DEFAULT'),
            field(CITY_STORES.STREETS, 'SIDEWALK_HOVER'),
            field(CITY_STORES.STREETS, 'SIDEWALK_SELECTED'),
          ],
        },
        {
          key: 'path-lines',
          label: 'Path Lines',
          children: [
            field(CITY_STORES.STREETS, 'PATH_LINEWIDTH_PCT'),
            field(CITY_STORES.STREETS, 'PATH_OPACITY'),
            field(CITY_STORES.STREETS, 'HOVER_PATH_COLOR'),
            field(CITY_STORES.STREETS, 'HOVER_PATH_OPACITY'),
          ],
        },
      ],
    },
  ],
};
