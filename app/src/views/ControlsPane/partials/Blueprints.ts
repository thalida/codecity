// views/ControlsPane/partials/Blueprints.ts — Timeline blueprints section. How a
// not-yet-created file shows as a faint ghost of what it will become. Draft-backed
// like the rest of the World tab (applies on Save); only meaningful in Timeline mode.
import { field, type SectionNode } from '.';
import { BLUEPRINTS } from '@/state/stores/settings/blueprints';

export const BLUEPRINTS_SECTION: SectionNode = {
  key: 'blueprints',
  label: 'Timeline blueprints',
  description:
    'In Timeline mode, a file created after the scrubbed commit shows as a faint ghost of what it will become; its folder’s roads and plots ghost in too.',
  children: [
    field(BLUEPRINTS, 'ENABLED'),
    field(BLUEPRINTS, 'OPACITY'),
    field(BLUEPRINTS, 'COLOR'),
  ],
};
