// views/ControlsPane/partials/Timeline.ts — Timeline section. How the scene
// represents a file that doesn't exist at the scrubbed commit: a deleted one
// leaves a faint gray stub, and one that hasn't been written yet simply isn't
// there. Draft-backed like the rest of the World tab (applies on Save); only
// meaningful in Timeline mode.
import { field, type SectionNode } from '.';
import { RUINS } from '@/state/stores/settings/ruins';
import { SCRUBBER } from '@/state/stores/settings/scrubber';

export const TIMELINE_SECTION: SectionNode = {
  key: 'timeline',
  label: 'Timeline',
  description:
    'How the scene shows files that don’t exist at the scrubbed commit: ones deleted before it, and ones created after it.',
  children: [
    {
      key: 'timeline-scrubber',
      label: 'Scrubber',
      description: 'How commits are spaced along the scrub track.',
      children: [field(SCRUBBER, 'INDEX_WEIGHT')],
    },
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
  ],
};
