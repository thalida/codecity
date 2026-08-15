// views/ControlsPane/partials/Sky.ts — the backdrop behind the city.
import { field, type SectionNode } from '.';
import { SCENE } from '@/state/stores/settings/scene';

export const SKY_SECTION: SectionNode = {
  key: 'sky',
  label: 'Sky & atmosphere',
  description: 'Everything behind the city. (Sun lighting is fixed in code.)',
  children: [
    { key: 'sky-color', label: 'Sky', children: [field(SCENE, 'SKY_COLOR')] },
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
