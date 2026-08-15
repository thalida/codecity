// panes/ControlsPane/ActionsBar — the sticky Reset all | Discard · Save bar,
// shown only where settings are draft-backed. Widgets write drafts; Save
// commits them. Updates and Appearance autosave straight to their stores, so
// they never render this and Reset all never reaches them.

import './ActionsBar.css';
import { RotateCcw } from 'lucide-preact';
import {
  commit as commitDrafts,
  discard as discardDrafts,
  isDirty as draftsAreDirty,
  stageResetAll,
  anyResettable,
  DRAFTS_REV,
} from '@/state/settingsDrafts';
import { HAS_ANY_NON_DEFAULT } from '@/state/settingsSchema';

export function ActionsBar() {
  // Both signals tracked, so the bar re-renders on a draft OR a committed
  // change; anyResettable() then answers across every store.
  void DRAFTS_REV.value;
  void HAS_ANY_NON_DEFAULT.value;

  const dirty = draftsAreDirty();
  const canReset = anyResettable();

  return (
    <div class="controls-actions surface-sidebar">
      <div class="controls-actions-left">
        <button
          type="button"
          class="btn-secondary controls-button"
          title="Stage every overridden value back to its default. Click Save to apply."
          disabled={!canReset}
          onClick={() => stageResetAll()}
        >
          <RotateCcw class="icon controls-button-icon" />
          Reset all
        </button>
      </div>
      <div class="controls-actions-right">
        <button
          type="button"
          class="btn-secondary controls-button"
          title="Drop all unsaved changes."
          disabled={!dirty}
          onClick={() => discardDrafts()}
        >
          Discard
        </button>
        <button
          type="button"
          class="btn-primary controls-button"
          title="Apply unsaved changes to the scene."
          disabled={!dirty}
          onClick={() => commitDrafts()}
        >
          Save
        </button>
      </div>
    </div>
  );
}
