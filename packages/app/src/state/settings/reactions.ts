// state/settings/reactions.ts — the "rebuilding" flash on a Save that only
// refreshes. See README.md.
//
// The rebuild half used to live here: two route-generated signatures over the
// app's settings signals, one of which re-applied a manifest to a city. A city
// re-packs itself now — it is handed the values, it knows which of its own
// fields moved and what each one's route costs, and it holds the manifest it is
// showing, which is the part the app could never get right with two cities on
// the page. What is left is a readout, and a readout is the app's.

import { computed, effect, untracked } from '@preact/signals';

import {
  REBUILD_STATUS,
  RebuildStatus,
  LAST_UPDATED_AT,
  markRebuilding,
  markIdle,
} from '@/state/stores/progress';
import { routeSignature, ChangeRoute } from '@/state/settings/schema';

// Min-dwell for the 'rebuilding' indicator on the material-only path.
const HOT_REBUILD_MIN_DWELL_MS = 220;

// Changes iff a Refresh-routed field changes, so a Rebuild Save never fires it.
const REFRESH_SIGNATURE = computed(() => routeSignature(ChangeRoute.Refresh));

/** Flash "rebuilding" when a Save lands that the scene answers by refreshing
 *  its materials rather than re-packing. Attach to the SCENE city only: this
 *  writes the readout above that city, and the landing's wallpaper has none. */
export function attachSettingsReactions(): () => void {
  // Effects fire synchronously on first call. Suppress until subscriptions are
  // wired so the initial fire doesn't flash a status for nothing.
  let armed = false;
  let hotIdleTimer: ReturnType<typeof setTimeout> | 0 = 0;

  // The refresh itself is reactive (see README.md); this is only the brief
  // status flash so the Save visibly registers.
  function flagRefresh() {
    if (!armed) return;
    if (hotIdleTimer) clearTimeout(hotIdleTimer);
    markRebuilding();
    // Min-dwell so the flash is visible, and only if no real rebuild is in
    // flight: the city's own build owns the final status then.
    hotIdleTimer = setTimeout(() => {
      hotIdleTimer = 0;
      if (REBUILD_STATUS.peek() === RebuildStatus.Rebuilding) {
        markIdle();
        LAST_UPDATED_AT.value = Date.now();
      }
    }, HOT_REBUILD_MIN_DWELL_MS);
  }

  // untracked, or the effect subscribes to whatever the imperative work reads
  // and re-fires on its own writes.
  const unsubRefresh = effect(() => {
    void REFRESH_SIGNATURE.value; // establish tracking
    if (!armed) return;
    untracked(() => flagRefresh());
  });

  armed = true;

  return function dispose() {
    armed = false;
    if (hotIdleTimer) {
      clearTimeout(hotIdleTimer);
      hotIdleTimer = 0;
    }
    unsubRefresh();
  };
}
