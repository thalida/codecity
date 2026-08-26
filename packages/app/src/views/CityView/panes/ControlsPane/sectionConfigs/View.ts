// views/ControlsPane/sections/View.ts — the opening pose of each camera the app
// has: the one a project opens at, and the one the landing's wallpaper orbits.
import { field } from '@/utils/field';
import type { SectionNode } from '@/types/controls';
import { CAMERA } from '@/state/settings/fields/camera';
import { HOME_BACKDROP } from '@/state/settings/fields/homeBackdrop';

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
      children: [field(CAMERA, 'ELEVATION'), field(CAMERA, 'AZIMUTH')],
    },
    {
      key: 'home-backdrop',
      label: 'Home Backdrop',
      description: 'The turntable circling the gem behind the home page, where you pick a project.',
      children: [
        field(HOME_BACKDROP, 'ELEVATION'),
        field(HOME_BACKDROP, 'AZIMUTH'),
        field(HOME_BACKDROP, 'DISTANCE'),
        field(HOME_BACKDROP, 'ROTATE_SPEED'),
      ],
    },
  ],
};
