// views/ControlsPane/partials/Blueprints.ts — Timeline future-files section. How a
// not-yet-created file shows as an ultra-low tinted slab where it will land.
// Draft-backed like the rest of the World tab (applies on Save); only meaningful
// in Timeline mode.
import { field, type SectionNode } from '.';
import { BLUEPRINTS } from '@/state/stores/settings/blueprints';

export const BLUEPRINTS_SECTION: SectionNode = {
  key: 'blueprints',
  label: 'Timeline future files',
  description:
    'In Timeline mode, a file created after the scrubbed commit shows as an ultra-low tinted slab where it will land; its folder’s roads tint in too.',
  children: [
    field(BLUEPRINTS, 'ENABLED'),
    field(BLUEPRINTS, 'BUILDING_OPACITY'),
    field(BLUEPRINTS, 'ROAD_OPACITY'),
    field(BLUEPRINTS, 'BUILDING_COLOR'),
    field(BLUEPRINTS, 'ROAD_COLOR'),
  ],
};
