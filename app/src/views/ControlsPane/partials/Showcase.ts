// views/ControlsPane/partials/Showcase.ts — Showcase section: the switcher's
// hero turntable. Draft-backed like the rest of World; the cameraRig re-enters
// the orbit on save.
import { field, type SectionNode } from '.';
import { SHOWCASE } from '@/state/stores/settings/showcase';

export const SHOWCASE_SECTION: SectionNode = {
  key: 'showcase',
  label: 'Showcase',
  description: 'The ground-level orbit the project switcher circles the root gem in.',
  children: [
    field(SHOWCASE, 'ELEVATION'),
    field(SHOWCASE, 'AZIMUTH'),
    field(SHOWCASE, 'DISTANCE'),
    field(SHOWCASE, 'ROTATE_SPEED'),
  ],
};
