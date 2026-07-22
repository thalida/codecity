// state/stores/settings/ruins.ts — Ghost-ruins in Timeline mode: how a deleted
// file's building persists as you scrub past its deletion (instead of vanishing).
// Read live by the scrub controller each frame (ChangeRoute.Live) and autosave
// (instant, no Save button) so toggling reads back immediately while scrubbing.

import {
  settingSignal,
  markAutosave,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settingsSchema';

const RUINS_FIELDS = {
  ENABLED: {
    route: ChangeRoute.Live,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Show ruins',
    tip: 'When on, a file deleted before the scrubbed commit leaves a faint gray stub instead of vanishing. Roads and plots of a deleted folder ghost in too.',
  },
  OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.2,
    min: 0.02,
    max: 1,
    step: 0.02,
    label: 'Opacity',
    tip: 'How faint a ruin is. Low reads as a ghost; 1 is fully solid.',
  },
  STUB_HEIGHT: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.35,
    min: 0.05,
    max: 2,
    step: 0.05,
    label: 'Stub height',
    tip: 'Ruin stub height in floors. Uniform for every ruin, independent of how big the file once was.',
  },
  DESATURATION: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.7,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Desaturation',
    tip: 'How far a ruined building color is pulled toward gray. 0 keeps its file color, 1 is fully gray.',
  },
  ROAD_COLOR: {
    route: ChangeRoute.Live,
    kind: FieldKind.Color,
    default: '#3d3a4a',
    label: 'Ruined road color',
    tip: 'Tint for the plots and roads of a deleted folder, so a ruined block reads apart from a live one.',
  },
} satisfies FieldMap;

export const RUINS = settingSignal('RUINS', RUINS_FIELDS);
markAutosave(RUINS);
export type RuinsConfig = ConfigOf<typeof RUINS_FIELDS>;
