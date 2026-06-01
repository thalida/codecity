// views/panes/controls/ActionsBar.tsx — Sticky bottom three-button bar.
// Reset all (left) | Discard · Save (right). Widgets write to the draft
// layer; Save commits to stores (triggers existing persist + commit-
// reaction subscriptions). Discard drops pending drafts. Reset all
// stages every overridden value back to its default — user still must
// Save to apply.

import { RotateCcw } from 'lucide-preact';
import {
  commit as commitDrafts,
  discard as discardDrafts,
  isDirty as draftsAreDirty,
  stageResetAll,
  DRAFTS_REV,
  getEffective,
} from '@/state/drafts';
import { forEachRegisteredStore, HAS_ANY_NON_DEFAULT, deepEqual } from '@/state/persist';

interface MapLikeStore {
  get value(): any;
  set?(value: any): void;
  setKey?(key: string, value: any): void;
  subscribe(listener: (state: any) => void): () => void;
}

function _canResetAll(): boolean {
  let canReset = false;
  forEachRegisteredStore((store, defaults) => {
    if (canReset) return;
    if (
      defaults &&
      typeof defaults === 'object' &&
      !Array.isArray(defaults) &&
      typeof (store as MapLikeStore).setKey === 'function'
    ) {
      for (const k in defaults) {
        if (!Object.hasOwn(defaults, k)) continue;
        if (
          !deepEqual(
            getEffective(store as MapLikeStore, k),
            (defaults as Record<string, unknown>)[k]
          )
        ) {
          canReset = true;
          return;
        }
      }
    } else if (!deepEqual(getEffective(store as MapLikeStore, null), defaults)) {
      canReset = true;
    }
  });
  return canReset;
}

export function ActionsBar() {
  // Reactive tracking: both signals participate so the bar re-renders on
  // either a draft change or a committed-value change.
  void DRAFTS_REV.value;
  void HAS_ANY_NON_DEFAULT.value;

  const dirty = draftsAreDirty();
  const canReset = _canResetAll();

  return (
    <div class="controls-actions">
      <div class="controls-actions-left">
        <button
          type="button"
          class="btn-secondary controls-button"
          title="Stage every overridden value back to its default. Click Save to apply."
          disabled={!canReset}
          onClick={() => stageResetAll()}
        >
          <RotateCcw class="lucide-icon controls-button-icon" />
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
