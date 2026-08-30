// features/city/components/ControlsPane/sectionConfigs/PostProcessing.ts — full-frame passes, plus the
// shared highlight color the selected outline and path line both chase.
import { CITY_STORES } from '@/features/settings/state/values/city';
import { field } from '@/features/city/field';
import type { SectionNode } from '@/features/city/components/ControlsPane/types';

export const POST_PROCESSING_SECTION: SectionNode = {
  key: 'post-processing',
  label: 'Post-Processing',
  description: 'Effects applied to the whole frame.',
  children: [
    {
      key: 'bloom',
      label: 'Bloom (HDR Neon Glow)',
      children: [
        field(CITY_STORES.BLOOM, 'ENABLED'),
        field(CITY_STORES.BLOOM, 'STRENGTH'),
        field(CITY_STORES.BLOOM, 'RADIUS'),
        field(CITY_STORES.BLOOM, 'THRESHOLD'),
      ],
    },
    {
      key: 'highlight',
      label: 'Highlight Color',
      description: 'The animated rainbow shared by selected outlines and the path line.',
      children: [
        field(CITY_STORES.RAINBOW, 'SPEED'),
        field(CITY_STORES.RAINBOW, 'SATURATION'),
        field(CITY_STORES.RAINBOW, 'LIGHTNESS'),
      ],
    },
  ],
};
