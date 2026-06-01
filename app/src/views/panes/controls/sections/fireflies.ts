// views/panes/controls/sections/fireflies.ts — Fireflies section declaration.
import { field, type SectionNode } from '.';
import { FIREFLIES } from '@/state/settings/fireflies';

export const FIREFLIES_SECTION: SectionNode = {
  key: 'fireflies',
  label: 'Fireflies',
  description: 'Glowing motes that orbit each commit-tree, colored per author.',
  children: [
    { key: 'visibility', label: 'Visibility', children: [field(FIREFLIES, 'ENABLED')] },
    {
      key: 'size',
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
      label: 'Orbit ring',
      children: [field(FIREFLIES, 'ORBIT_RING_ENABLED'), field(FIREFLIES, 'ORBIT_RING_THICKNESS')],
    },
  ],
};
