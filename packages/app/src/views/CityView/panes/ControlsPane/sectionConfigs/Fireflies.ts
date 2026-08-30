// views/ControlsPane/sections/Fireflies.ts — motes orbiting each commit-tree.
import { CITY_STORES } from '@/state/settings/values/city';
import { field } from '@/views/CityView/field';
import type { SectionNode } from '@/views/CityView/panes/ControlsPane/types';

export const FIREFLIES_SECTION: SectionNode = {
  key: 'fireflies',
  label: 'Fireflies',
  description: 'Glowing motes that orbit each commit-tree, colored per author.',
  children: [
    field(CITY_STORES.FIREFLIES, 'ENABLED'),
    {
      key: 'fireflies-size',
      label: 'Size',
      children: [
        field(CITY_STORES.FIREFLIES, 'SCALE_MIN'),
        field(CITY_STORES.FIREFLIES, 'SCALE_MAX'),
      ],
    },
    {
      key: 'motion',
      label: 'Motion',
      children: [
        field(CITY_STORES.FIREFLIES, 'ORBIT_SPEED'),
        field(CITY_STORES.FIREFLIES, 'BOB_AMPLITUDE'),
        field(CITY_STORES.FIREFLIES, 'BOB_SPEED'),
      ],
    },
    {
      key: 'brightness',
      label: 'Brightness',
      children: [
        field(CITY_STORES.FIREFLIES, 'EMISSION_STRENGTH'),
        field(CITY_STORES.FIREFLIES, 'PULSE_AMPLITUDE'),
        field(CITY_STORES.FIREFLIES, 'PULSE_SPEED'),
        field(CITY_STORES.FIREFLIES, 'FLICKER_AMOUNT'),
      ],
    },
    {
      key: 'orbit-ring',
      label: 'Orbit Ring',
      children: [
        field(CITY_STORES.FIREFLIES, 'ORBIT_RING_ENABLED'),
        field(CITY_STORES.FIREFLIES, 'ORBIT_RING_THICKNESS'),
      ],
    },
  ],
};
