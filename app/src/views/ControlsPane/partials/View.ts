// views/ControlsPane/partials/View.ts — the two camera poses, as siblings
// because both are just an elevation/azimuth pair.
import { field, type SectionNode } from '.';
import { CAMERA } from '@/state/stores/settings/camera';
import { SHOWCASE } from '@/state/stores/settings/showcase';

export const VIEW_SECTION: SectionNode = {
  key: 'view',
  label: 'View',
  description: 'Where the camera sits.',
  children: [
    {
      key: 'default-angle',
      label: 'Default angle',
      description: 'How the default view frames the city, always looking at the root gem.',
      children: [field(CAMERA, 'ELEVATION'), field(CAMERA, 'AZIMUTH')],
    },
    {
      key: 'showcase-orbit',
      label: 'Showcase orbit',
      description: 'The ground-level orbit the project switcher circles the gem in.',
      children: [
        field(SHOWCASE, 'ELEVATION'),
        field(SHOWCASE, 'AZIMUTH'),
        field(SHOWCASE, 'DISTANCE'),
        field(SHOWCASE, 'ROTATE_SPEED'),
      ],
    },
  ],
};
