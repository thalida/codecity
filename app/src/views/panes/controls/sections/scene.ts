// views/panes/controls/sections/scene.ts — Scene section declaration. SCENE
// holds the backdrop visuals (sky/stars/fog); WORLD holds the ground-sizing
// knob — both placed here as arrangement.
import { field, type SectionNode } from '.';
import { SCENE, WORLD } from '@/state/stores/settings/scene';

export const SCENE_SECTION: SectionNode = {
  key: 'scene',
  label: 'Scene',
  description:
    'Sky, stars, ground, and atmosphere — everything that frames the city. (Sun lighting is fixed in code.)',
  children: [
    { key: 'sky', label: 'Sky', children: [field(SCENE, 'SKY_COLOR')] },
    {
      key: 'stars',
      label: 'Stars',
      children: [field(SCENE, 'STARS_ENABLED'), field(SCENE, 'STARS_DENSITY')],
    },
    {
      key: 'ground-sizing',
      label: 'Ground sizing',
      children: [field(WORLD, 'GROUND_BUFFER_PERCENT')],
    },
    {
      key: 'ground-haze',
      label: 'Ground haze',
      children: [
        field(SCENE, 'FOG_ENABLED'),
        field(SCENE, 'FOG_COLOR'),
        field(SCENE, 'FOG_INTENSITY'),
        field(SCENE, 'FOG_HEIGHT_FRAC'),
      ],
    },
  ],
};
