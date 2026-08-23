// views/ControlsPane/sections/Fireflies.ts — motes orbiting each commit-tree.
import { field } from '@/utils/field';
import type { SectionNode } from '@/types/controls';
import { FIREFLIES } from '@/city/session/settings/fireflies';

export const FIREFLIES_SECTION: SectionNode = {
  key: 'fireflies',
  label: 'Fireflies',
  description: 'Glowing motes that orbit each commit-tree, colored per author.',
  children: [
    field(FIREFLIES, 'ENABLED'),
    {
      key: 'fireflies-size',
      label: 'Size',
      children: [field(FIREFLIES, 'SCALE_MIN'), field(FIREFLIES, 'SCALE_MAX')],
    },
    {
      key: 'motion',
      label: 'Motion',
      children: [
        field(FIREFLIES, 'ORBIT_SPEED'),
        field(FIREFLIES, 'BOB_AMPLITUDE'),
        field(FIREFLIES, 'BOB_SPEED'),
      ],
    },
    {
      key: 'brightness',
      label: 'Brightness',
      children: [
        field(FIREFLIES, 'EMISSION_STRENGTH'),
        field(FIREFLIES, 'PULSE_AMPLITUDE'),
        field(FIREFLIES, 'PULSE_SPEED'),
        field(FIREFLIES, 'FLICKER_AMOUNT'),
      ],
    },
    {
      key: 'orbit-ring',
      label: 'Orbit Ring',
      children: [field(FIREFLIES, 'ORBIT_RING_ENABLED'), field(FIREFLIES, 'ORBIT_RING_THICKNESS')],
    },
  ],
};
