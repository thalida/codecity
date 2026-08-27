// settings/fields/scrubber.ts — how the Timeline scrubber lays commits
// along its track. World-tab (draft-backed) store; ChangeRoute.Live.

import { FieldKind, ChangeRoute, type ConfigOf, type FieldMap } from '../schema';

export const SCRUBBER_FIELDS = {
  INDEX_WEIGHT: {
    route: ChangeRoute.Live,
    kind: FieldKind.SliderField,
    default: 0,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Even spacing',
    tip: '0 places each commit by when it happened, so busy bursts bunch tight. 1 gives every commit the same width. In between keeps the shape of time, still grabbable.',
  },
} satisfies FieldMap;

export type ScrubberConfig = ConfigOf<typeof SCRUBBER_FIELDS>;
