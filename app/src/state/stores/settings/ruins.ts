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
    label: 'Show deleted files',
    tip: 'When on, a file deleted before the scrubbed commit leaves a faint gray stub instead of vanishing. Roads and plots of a deleted folder fade in too.',
  },
  BUILDING_OPACITY: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.2,
    min: 0.02,
    max: 1,
    step: 0.02,
    label: 'Building opacity',
    tip: 'How faint a deleted file’s building stub is. Low reads as a ghost; 1 is fully solid.',
  },
  STUB_HEIGHT: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 2,
    min: 0.05,
    max: 4,
    step: 0.05,
    label: 'Building height',
    tip: 'Height in floors for a deleted file’s stub. Uniform for every one, independent of how big the file once was.',
  },
  DESATURATION: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.1,
    min: 0,
    max: 1,
    step: 0.05,
    label: 'Desaturation',
    tip: 'How far a deleted file’s building color is pulled toward gray. 0 keeps its file color, 1 is fully gray.',
  },
  X_ENABLED: {
    route: ChangeRoute.Live,
    kind: FieldKind.Toggle,
    default: true,
    label: 'Cross out the roof',
    tip: 'When on, a deleted file’s roof is crossed out. The file-type icon stays readable underneath.',
  },
  X_COLOR: {
    route: ChangeRoute.Live,
    kind: FieldKind.Color,
    default: '#ff3b3b',
    label: 'Cross color',
    tip: 'Color of the cross over a deleted file’s roof.',
  },
  X_WIDTH: {
    route: ChangeRoute.Live,
    kind: FieldKind.Slider,
    default: 0.18,
    min: 0.02,
    max: 0.6,
    step: 0.02,
    label: 'Cross thickness',
    tip: 'How thick each stroke of the cross is, as a fraction of the roof. High values swallow the icon underneath.',
  },
  ROAD_COLOR: {
    route: ChangeRoute.Live,
    kind: FieldKind.Color,
    default: '#050703',
    label: 'Road color',
    tip: 'Tint for the plots and roads of a deleted folder, so a deleted block reads apart from a live one.',
  },
  SIDEWALK_COLOR: {
    route: ChangeRoute.Live,
    kind: FieldKind.Color,
    default: '#070906',
    label: 'Sidewalk color',
    tip: 'Color for the sidewalk border strip of a deleted folder road.',
  },
} satisfies FieldMap;

export const RUINS = settingSignal('RUINS', RUINS_FIELDS);
export type RuinsConfig = ConfigOf<typeof RUINS_FIELDS>;
