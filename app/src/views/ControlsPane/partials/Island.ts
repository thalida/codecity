// views/ControlsPane/partials/Island.ts — the island, plus the ground buffer
// that sets how big it is.
import { field, type SectionNode } from '.';
import { ISLAND, WORLD } from '@/state/stores/settings/island';

export const ISLAND_SECTION: SectionNode = {
  key: 'island',
  label: 'Island',
  description: 'The floating world-plane beneath the city.',
  children: [
    field(ISLAND, 'ENABLED'),
    {
      key: 'island-size',
      label: 'Size',
      children: [field(WORLD, 'GROUND_BUFFER_PERCENT')],
    },
    {
      key: 'shape',
      label: 'Shape',
      children: [
        field(ISLAND, 'SIDES'),
        field(ISLAND, 'IRREGULARITY'),
        field(ISLAND, 'TIERS'),
        field(ISLAND, 'DEPTH'),
        field(ISLAND, 'ROUNDNESS'),
        field(ISLAND, 'GRASS_THICKNESS'),
      ],
    },
    {
      key: 'colors',
      label: 'Colors',
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
