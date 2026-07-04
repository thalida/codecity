// state/stores/settings/updates.ts — Live-update polling. When ENABLED, the
// frontend re-fetches /api/manifest every POLL_SECONDS and re-renders in place
// when the manifest's signature changes (the tree's mtime/size state shifted).
//
// Default OFF so the tool stays cheap when nobody's actively editing.
// Schema-driven (see state/schema); POLL_SECONDS is clamped to a
// hard [min, max] range at the caller (manifestPoll), where those bounds live.

import {
  settingSignal,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settingsSchema';

const LIVE_UPDATES_FIELDS = {
  ENABLED: {
    route: ChangeRoute.Live,
    kind: FieldKind.Toggle,
    default: false,
    label: 'Enabled',
    tip: "When on, the city re-renders in place whenever the project's files change, checked every poll interval.",
  },
  POLL_SECONDS: {
    route: ChangeRoute.Live,
    kind: FieldKind.Number,
    default: 10,
    min: 1,
    max: 60,
    step: 1,
    label: 'Poll interval (s)',
    tip: 'How often to check for changes. Lower is snappier but heavier on the local server; higher is lighter but the city can feel stale.',
  },
} satisfies FieldMap;

export const LIVE_UPDATES = settingSignal('LIVE_UPDATES', LIVE_UPDATES_FIELDS);
export type LiveUpdatesConfig = ConfigOf<typeof LIVE_UPDATES_FIELDS>;
