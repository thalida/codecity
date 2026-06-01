// views/ControlsPane/partials/effects.ts — Effects section declaration.
import { field, type SectionNode } from '.';
import { RAINBOW, BLOOM } from '@/state/stores/settings/effects';

export const EFFECTS_SECTION: SectionNode = {
  key: 'effects',
  label: 'Effects',
  description: 'Shared visual effects + per-cell level-of-detail thresholds.',
  children: [
    {
      key: 'rainbow',
      label: 'Rainbow (selected outline + path line)',
      children: [field(RAINBOW, 'SPEED'), field(RAINBOW, 'SATURATION'), field(RAINBOW, 'LIGHTNESS')],
    },
    {
      key: 'bloom',
      label: 'Bloom (HDR neon glow)',
      children: [
        field(BLOOM, 'ENABLED'),
        field(BLOOM, 'WINDOW_EMISSION'),
        field(BLOOM, 'GEM_EMISSION'),
        field(BLOOM, 'AD_EMISSION'),
        field(BLOOM, 'STRENGTH'),
        field(BLOOM, 'RADIUS'),
        field(BLOOM, 'THRESHOLD'),
      ],
    },
  ],
};
