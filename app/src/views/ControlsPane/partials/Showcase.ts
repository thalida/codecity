// views/ControlsPane/partials/Showcase.ts — Showcase section: the switcher's
// hero turntable. SHOWCASE is autosave, so the sliders re-frame the backdrop
// live as you drag (the cameraRig subscribes and re-enters the orbit).
import { field, type SectionNode } from '.';
import { SHOWCASE } from '@/state/stores/settings/showcase';

export const SHOWCASE_SECTION: SectionNode = {
  key: 'showcase',
  label: 'Showcase',
  description:
    'The ground-level orbit the project switcher circles the root gem in. Open the switcher and drag to watch it re-frame live.',
  children: [
    field(SHOWCASE, 'ELEVATION'),
    field(SHOWCASE, 'AZIMUTH'),
    field(SHOWCASE, 'DISTANCE'),
    field(SHOWCASE, 'ROTATE_SPEED'),
  ],
};
