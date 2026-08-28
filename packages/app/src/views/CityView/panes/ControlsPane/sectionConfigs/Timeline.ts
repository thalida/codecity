// views/ControlsPane/sections/Timeline.ts — how the scene shows a file deleted
// before the scrubbed commit. Draft-backed like the rest of the World tab.
import { CITY_STORES } from '@/state/settings/values/city';
import { field } from '@/utils/field';
import type { SectionNode } from '@/types/controls';

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
      children: [field(CITY_STORES.SCRUBBER, 'INDEX_WEIGHT')],
    },
    {
      key: 'timeline-deleted',
      label: 'Deleted Files',
      description:
        'A file deleted before the scrubbed commit leaves a faint gray stub instead of vanishing; its folder’s roads and plots fade in too.',
      children: [
        field(CITY_STORES.RUINS, 'ENABLED'),
        field(CITY_STORES.RUINS, 'BUILDING_OPACITY'),
        field(CITY_STORES.RUINS, 'STUB_HEIGHT'),
        field(CITY_STORES.RUINS, 'DESATURATION'),
        field(CITY_STORES.RUINS, 'X_ENABLED'),
        field(CITY_STORES.RUINS, 'X_COLOR'),
        field(CITY_STORES.RUINS, 'X_WIDTH'),
        field(CITY_STORES.RUINS, 'ROAD_COLOR'),
        field(CITY_STORES.RUINS, 'SIDEWALK_COLOR'),
      ],
    },
  ],
};
