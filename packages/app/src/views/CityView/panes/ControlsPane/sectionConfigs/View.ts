// views/ControlsPane/sections/View.ts — the opening pose of each camera the app
// has: the one a project opens at, and the one the landing's wallpaper orbits.
// Two cities, so two cameras, declared from the same fields.
import { CITY_STORES } from '@/state/settings/values/city';
import { field } from '@/utils/field';
import type { SectionNode } from '@/types/controls';
import { HOME_BACKDROP } from '@/state/settings/values/city';

export const VIEW_SECTION: SectionNode = {
  key: 'view',
  label: 'Camera',
  description:
    'The angle a project opens at, and the orbit that circles the city on the home page.',
  children: [
    {
      key: 'project-view',
      label: 'Project View',
      description:
        'How a project opens, and where Reset view returns to. Always looking at the root gem.',
      children: [
        field(CITY_STORES.CAMERA, 'TARGET'),
        field(CITY_STORES.CAMERA, 'ELEVATION'),
        field(CITY_STORES.CAMERA, 'AZIMUTH'),
        field(CITY_STORES.CAMERA, 'DISTANCE_SCALE'),
        field(CITY_STORES.CAMERA, 'AUTO_ROTATE'),
        field(CITY_STORES.CAMERA, 'ROTATE_SPEED'),
      ],
    },
    {
      key: 'home-backdrop',
      label: 'Home Backdrop',
      description: 'The turntable circling the gem behind the home page, where you pick a project.',
      children: [
        field(HOME_BACKDROP, 'TARGET'),
        field(HOME_BACKDROP, 'ELEVATION'),
        field(HOME_BACKDROP, 'AZIMUTH'),
        field(HOME_BACKDROP, 'DISTANCE_SCALE'),
        field(HOME_BACKDROP, 'AUTO_ROTATE'),
        field(HOME_BACKDROP, 'ROTATE_SPEED'),
      ],
    },
  ],
};
