// views/ControlsPane/sections/PostProcessing.ts — full-frame passes, plus the
// shared highlight color the selected outline and path line both chase.
import { field } from '@/utils/field';
import type { SectionNode } from '@/types/controls';
import { RAINBOW, BLOOM } from '@/state/settings/fields/effects';

export const POST_PROCESSING_SECTION: SectionNode = {
  key: 'post-processing',
  label: 'Post-Processing',
  description: 'Effects applied to the whole frame.',
  children: [
    {
      key: 'bloom',
      label: 'Bloom (HDR Neon Glow)',
      children: [
        field(BLOOM, 'ENABLED'),
        field(BLOOM, 'STRENGTH'),
        field(BLOOM, 'RADIUS'),
        field(BLOOM, 'THRESHOLD'),
      ],
    },
    {
      key: 'highlight',
      label: 'Highlight Color',
      description: 'The animated rainbow shared by selected outlines and the path line.',
      children: [
        field(RAINBOW, 'SPEED'),
        field(RAINBOW, 'SATURATION'),
        field(RAINBOW, 'LIGHTNESS'),
      ],
    },
  ],
};
