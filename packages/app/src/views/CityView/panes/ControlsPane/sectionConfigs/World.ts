// panes/ControlsPane/sectionConfigs/World.ts — everything the city sits on and in:
// the island it stands on, and the sky and haze around it.
import { CITY_STORES } from '@/state/settings/values/city';
import { field } from '@/utils/field';
import type { SectionNode } from '@/types/controls';

export const WORLD_SECTION: SectionNode = {
  key: 'world',
  label: 'World',
  description: 'The ground the city stands on, and everything behind it.',
  children: [
    {
      key: 'island',
      label: 'Island',
      children: [
        field(CITY_STORES.ISLAND, 'ENABLED'),
        // How much bigger than the city the island is cut: its size, whatever
        // store it lives in.
        field(CITY_STORES.WORLD, 'GROUND_BUFFER_PERCENT'),
        {
          key: 'island-shape',
          label: 'Shape',
          children: [
            field(CITY_STORES.ISLAND, 'SIDES'),
            field(CITY_STORES.ISLAND, 'IRREGULARITY'),
            field(CITY_STORES.ISLAND, 'TIERS'),
            field(CITY_STORES.ISLAND, 'DEPTH'),
            field(CITY_STORES.ISLAND, 'ROUNDNESS'),
            field(CITY_STORES.ISLAND, 'GRASS_THICKNESS'),
          ],
        },
        {
          key: 'island-texture',
          label: 'Texture',
          children: [
            field(CITY_STORES.ISLAND, 'GRASS_TEXTURE'),
            field(CITY_STORES.ISLAND, 'GRASS_PATCH_SIZE'),
            field(CITY_STORES.ISLAND, 'ROCK_TEXTURE'),
            field(CITY_STORES.ISLAND, 'ROCK_PATCH_SIZE'),
          ],
        },
        {
          key: 'island-colors',
          label: 'Colors',
          children: [
            field(CITY_STORES.ISLAND, 'GRASS_COLOR'),
            field(CITY_STORES.ISLAND, 'GRASS_SIDE_COLOR'),
            field(CITY_STORES.ISLAND, 'ROCK_COLOR'),
            field(CITY_STORES.ISLAND, 'HEMI_SKY_COLOR'),
            field(CITY_STORES.ISLAND, 'HEMI_GROUND_COLOR'),
          ],
        },
      ],
    },
    {
      key: 'sky',
      label: 'Sky',
      children: [
        field(CITY_STORES.SCENE, 'SKY_COLOR'),
        {
          key: 'stars',
          label: 'Stars',
          children: [
            field(CITY_STORES.SCENE, 'STARS_ENABLED'),
            field(CITY_STORES.SCENE, 'STARS_DENSITY'),
          ],
        },
        {
          key: 'aurora',
          label: 'Aurora',
          children: [
            field(CITY_STORES.SCENE, 'AURORA_ENABLED'),
            field(CITY_STORES.SCENE, 'AURORA_INTENSITY'),
          ],
        },
      ],
    },
    {
      // Sun lighting is fixed in code, so the haze is all there is to tune.
      key: 'ground-haze',
      label: 'Ground Haze',
      children: [
        field(CITY_STORES.SCENE, 'FOG_ENABLED'),
        field(CITY_STORES.SCENE, 'FOG_COLOR'),
        field(CITY_STORES.SCENE, 'FOG_INTENSITY'),
        field(CITY_STORES.SCENE, 'FOG_HEIGHT_FRAC'),
      ],
    },
  ],
};
