// views/ControlsPane/partials/Timeline.ts — Timeline section. How the scene
// represents files that don't exist at the scrubbed commit: deleted files (a
// faint gray stub) and future files (an ultra-low tinted slab). One accordion
// with a subgroup per representation. Draft-backed like the rest of the World tab
// (applies on Save); only meaningful in Timeline mode.
import { field, type SectionNode } from '.';
import { RUINS } from '@/state/stores/settings/ruins';
import { BLUEPRINTS } from '@/state/stores/settings/blueprints';

export const TIMELINE_SECTION: SectionNode = {
  key: 'timeline',
  label: 'Timeline',
  description:
    'How the scene shows files that don’t exist at the scrubbed commit: ones deleted before it, and ones created after it.',
  children: [
    {
      key: 'timeline-deleted',
      label: 'Deleted files',
      description:
        'A file deleted before the scrubbed commit leaves a faint gray stub instead of vanishing; its folder’s roads and plots fade in too.',
      children: [
        field(RUINS, 'ENABLED'),
        field(RUINS, 'BUILDING_OPACITY'),
        field(RUINS, 'STUB_HEIGHT'),
        field(RUINS, 'DESATURATION'),
        field(RUINS, 'X_ENABLED'),
        field(RUINS, 'X_COLOR'),
        field(RUINS, 'X_WIDTH'),
        field(RUINS, 'ROAD_COLOR'),
        field(RUINS, 'SIDEWALK_COLOR'),
      ],
    },
    {
      key: 'timeline-future',
      label: 'Future files',
      description:
        'A file created after the scrubbed commit shows as an ultra-low tinted slab where it will land; its folder’s roads tint in too.',
      children: [
        field(BLUEPRINTS, 'ENABLED'),
        field(BLUEPRINTS, 'BUILDING_OPACITY'),
        field(BLUEPRINTS, 'BUILDING_COLOR'),
        field(BLUEPRINTS, 'BUILDING_TINT'),
        field(BLUEPRINTS, 'ROAD_COLOR'),
        field(BLUEPRINTS, 'SIDEWALK_COLOR'),
      ],
    },
  ],
};
