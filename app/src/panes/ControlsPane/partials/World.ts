// panes/ControlsPane/partials/World.ts — everything the city sits on and in:
// how much ground there is, the island cut from it, and the sky around it.
import { field, type SectionNode } from '.';
import { ISLAND, WORLD } from '@/state/stores/settings/island';
import { SCENE } from '@/state/stores/settings/scene';

export const WORLD_SECTION: SectionNode = {
  key: 'world',
  label: 'World',
  description: 'The ground the city stands on, and everything behind it.',
  children: [
    {
      key: 'world-size',
      label: 'Size',
      children: [field(WORLD, 'GROUND_BUFFER_PERCENT')],
    },
    {
      key: 'island',
      label: 'Island',
      children: [
        field(ISLAND, 'ENABLED'),
        {
          key: 'island-shape',
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
          key: 'island-texture',
          label: 'Texture',
          children: [
            field(ISLAND, 'GRASS_TEXTURE'),
            field(ISLAND, 'GRASS_PATCH_SIZE'),
            field(ISLAND, 'ROCK_TEXTURE'),
            field(ISLAND, 'ROCK_PATCH_SIZE'),
          ],
        },
        {
          key: 'island-colors',
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
    },
    {
      key: 'sky',
      label: 'Sky',
      children: [
        field(SCENE, 'SKY_COLOR'),
        {
          key: 'stars',
          label: 'Stars',
          children: [field(SCENE, 'STARS_ENABLED'), field(SCENE, 'STARS_DENSITY')],
        },
        {
          key: 'aurora',
          label: 'Aurora',
          children: [field(SCENE, 'AURORA_ENABLED'), field(SCENE, 'AURORA_INTENSITY')],
        },
      ],
    },
    {
      // Sun lighting is fixed in code, so haze is all there is to tune here.
      key: 'atmosphere',
      label: 'Atmosphere',
      children: [
        field(SCENE, 'FOG_ENABLED'),
        field(SCENE, 'FOG_COLOR'),
        field(SCENE, 'FOG_INTENSITY'),
        field(SCENE, 'FOG_HEIGHT_FRAC'),
      ],
    },
  ],
};
