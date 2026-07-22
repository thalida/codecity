// views/ControlsPane/partials/Ruins.ts — Timeline ghost-ruins section. How a
// deleted file's building persists as you scrub past its deletion. Draft-backed
// like the rest of the World tab (applies on Save); only visible in Timeline mode.
import { field, type SectionNode } from '.';
import { RUINS } from '@/state/stores/settings/ruins';

export const RUINS_SECTION: SectionNode = {
  key: 'ruins',
  label: 'Timeline ruins',
  description:
    'In Timeline mode, a file deleted before the scrubbed commit leaves a faint gray stub instead of vanishing; its folder’s roads and plots ghost in too.',
  children: [
    field(RUINS, 'ENABLED'),
    field(RUINS, 'BUILDING_OPACITY'),
    field(RUINS, 'ROAD_OPACITY'),
    field(RUINS, 'STUB_HEIGHT'),
    field(RUINS, 'DESATURATION'),
    field(RUINS, 'ROAD_COLOR'),
  ],
};
