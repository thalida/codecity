// state/settings/fields/updates.ts — live-update polling: re-fetch the manifest
// every POLL_SECONDS and re-render in place when its content_signature moves.
// On by default so the city tracks edits out of the box. manifestPoll owns the
// hard bounds POLL_SECONDS is clamped to.
import type { SourceStore } from '@/city/session/stores/source';
import {
  settingSignal,
  markAutosave,
  FieldKind,
  ChangeRoute,
  type ConfigOf,
  type FieldMap,
} from '@/state/settings/schema';

const LIVE_UPDATES_FIELDS = {
  ENABLED: {
    route: ChangeRoute.Live,
    kind: FieldKind.ToggleField,
    default: true,
    label: 'Auto-refresh',
    tip: "Re-render the city whenever the project's files change.",
  },
  POLL_SECONDS: {
    route: ChangeRoute.Live,
    kind: FieldKind.Number,
    default: 5,
    min: 1,
    max: 60,
    step: 1,
    label: 'Poll interval (s)',
    tip: 'How often to check for changes. Lower is snappier, heavier on the server.',
  },
} satisfies FieldMap;

export const LIVE_UPDATES = settingSignal('LIVE_UPDATES', LIVE_UPDATES_FIELDS);
// Autosave (write-through): the Updates tab applies on change, no Save step.
markAutosave(LIVE_UPDATES);
export type LiveUpdatesConfig = ConfigOf<typeof LIVE_UPDATES_FIELDS>;

/** The toggle AND a local source. Remote is excluded on cost: ensure_clone
 *  fetches on every open, so polling one means a git fetch every few seconds. */
/** Whether this project is being watched for edits: the setting is app-wide,
 *  but only a working tree on disk can change under the app. */
export function liveUpdatesActive(source: SourceStore): boolean {
  return LIVE_UPDATES.value.ENABLED && source.isLocal.value;
}
