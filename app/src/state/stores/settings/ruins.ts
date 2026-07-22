// state/stores/settings/ruins.ts — Ghost-ruins in Timeline mode: how a deleted
// file's building persists as you scrub past its deletion (instead of vanishing).
// A World-tab (draft-backed) store like the rest of that tab: edits apply on
// Save, not live. ChangeRoute.Live because the scrub controller reads the
// committed value each frame — a commit needs no scene rebuild/refresh.

import {
  settingSignal,
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
  BUILDING_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0.02,
    max: 1,
    step: 0.02,
    label: 'Building opacity',
    tip: 'How faint a ruined building stub is. Low reads as a ghost; 1 is fully solid.',
  },
  ROAD_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.5,
    min: 0.02,
    max: 1,
    step: 0.02,
    label: 'Road opacity',
    tip: 'How faint a deleted folder road and plots are.',
  },
  STUB_HEIGHT: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 2,
    min: 0.05,
    max: 4,
    step: 0.05,
    label: 'Stub height',
    tip: 'Ruin height in floors. Uniform for every ruin, independent of how big the file once was.',
  },
  DESATURATION: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.1,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Desaturation',
    tip: 'How far a ruined building color is pulled toward gray. 0 keeps its file color, 1 is fully gray.',
  },
  ROAD_COLOR: {
    route: ChangeRoute.Live,
    kind: FieldKind.Color,
    default: '#040301',
    label: 'Ruined road color',
    tip: 'Tint for the plots and roads of a deleted folder, so a ruined block reads apart from a live one.',
  },
} satisfies FieldMap;

export const RUINS = settingSignal('RUINS', RUINS_FIELDS);
export type RuinsConfig = ConfigOf<typeof RUINS_FIELDS>;
