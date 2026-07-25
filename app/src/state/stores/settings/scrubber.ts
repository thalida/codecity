// state/stores/settings/scrubber.ts — how the Timeline scrubber lays commits
// along its track. World-tab (draft-backed) store; ChangeRoute.Live.

import {
  settingSignal,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settingsSchema';

const SCRUBBER_FIELDS = {
  INDEX_WEIGHT: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Even spacing',
    tip: '0 places each commit purely by when it happened, so busy bursts bunch up tight. 1 gives every commit the same width, so a long gap looks like a short one. In between keeps the shape of time while leaving each commit wide enough to grab.',
  },
} satisfies FieldMap;

export const SCRUBBER = settingSignal('SCRUBBER', SCRUBBER_FIELDS);
export type ScrubberConfig = ConfigOf<typeof SCRUBBER_FIELDS>;
