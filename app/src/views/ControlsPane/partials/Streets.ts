// views/ControlsPane/partials/Streets.ts — Streets section declaration.
// Road sizing + packing (STREET_TIERS, STREET_LAYOUT) and the asphalt /
// sidewalk / label / path-line visuals (STREETS) that paint on top. Subgroups
// are arrangement only; the stores own each field. (The city footprint slab is
// its own top-level section — see ./footprint.)
import { field, type SectionNode } from '.';
import { STREETS, STREET_TIERS, STREET_LAYOUT } from '@/state/stores/settings/streets';

export const STREETS_SECTION: SectionNode = {
  key: 'streets',
  label: 'Streets',
  description:
    'Road network sizing + packing, plus the asphalt, sidewalks, labels, and route-highlight visuals that paint on top.',
  children: [
    {
      key: 'tiers',
      label: 'Street width tiers',
      children: [field(STREET_TIERS, 'TIERS')],
    },
    {
      key: 'spacing',
      label: 'Street spacing',
      children: [
        field(STREET_LAYOUT, 'CHILD_GAP'),
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
      key: 'sidewalks',
      label: 'Sidewalk colors',
      children: [
        field(STREETS, 'SIDEWALK_DEFAULT'),
        field(STREETS, 'SIDEWALK_HOVER'),
        field(STREETS, 'SIDEWALK_SELECTED'),
      ],
    },
    {
      key: 'labels',
      label: 'Street labels',
      children: [
        field(STREETS, 'LABEL_FILL'),
        field(STREETS, 'LABEL_STROKE'),
        field(STREETS, 'LABEL_STROKE_WIDTH_FRAC'),
        field(STREETS, 'LABEL_HEIGHT_FRAC'),
      ],
    },
    {
      key: 'path-lines',
      label: 'Path lines',
      children: [
        field(STREETS, 'PATH_LINEWIDTH_PCT'),
        field(STREETS, 'PATH_OPACITY'),
        field(STREETS, 'HOVER_PATH_COLOR'),
        field(STREETS, 'HOVER_PATH_OPACITY'),
      ],
    },
  ],
};
