// views/panes/controls/sections/island.ts — Island section declaration. One
// ISLAND store; the Geometry/Materials subgroups are arrangement only.
import { field, type SectionNode } from '.';
import { ISLAND } from '@/state/settings/island';

export const ISLAND_SECTION: SectionNode = {
  key: 'island',
  label: 'Island',
  description:
    'Floating-island world-plane beneath the city. Geometry controls the polygon silhouette and depth; Materials set the baked colors and lighting.',
  children: [
    {
      key: 'geometry',
      label: 'Geometry',
      children: [
        field(ISLAND, 'ENABLED'),
        field(ISLAND, 'SIDES'),
        field(ISLAND, 'IRREGULARITY'),
        field(ISLAND, 'TIERS'),
        field(ISLAND, 'DEPTH'),
        field(ISLAND, 'ROUNDNESS'),
        field(ISLAND, 'GRASS_THICKNESS'),
      ],
    },
    {
      key: 'materials',
      label: 'Materials',
      children: [
        field(ISLAND, 'GRASS_COLOR'),
        field(ISLAND, 'GRASS_SIDE_COLOR'),
        field(ISLAND, 'ROCK_COLOR'),
        field(ISLAND, 'HEMI_SKY_COLOR'),
        field(ISLAND, 'HEMI_GROUND_COLOR'),
      ],
    },
  ],
};
