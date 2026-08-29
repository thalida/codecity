// state/settings/reactions.ts — the "rebuilding" flash on a Save that only
// refreshes. See README.md.
//
// The rebuild half used to live here: two route-generated signatures over the
// app's settings signals, one of which re-applied a manifest to a city. A city
// re-packs itself now — it is handed the values, it knows which of its own
// fields moved and what each one's route costs, and it holds the manifest it is
// showing, which is the part the app could never get right with two cities on
// the page. What is left is a readout, and a readout is the app's.

import { ChangeRoute } from '@codecity/city';
import type { City } from '@codecity/city';

import { HOST_WORK, beginHostWork, endHostWork } from '@/state/stores/progress';

// Min-dwell for the 'rebuilding' indicator on the material-only path.
const HOT_REBUILD_MIN_DWELL_MS = 220;

/** Flash "rebuilding" when a Save lands that the scene answers by refreshing
 *  its materials rather than re-packing. Attach to the SCENE city only: this
 *  writes the readout above that city, and the landing's wallpaper has none. */
export function attachSettingsReactions(city: Pick<City, 'settings'>): () => void {
  let hotIdleTimer: ReturnType<typeof setTimeout> | 0 = 0;

  // The refresh itself is reactive (see README.md); this is only the brief
  // status flash so the Save visibly registers.
  function flagRefresh() {
    if (hotIdleTimer) clearTimeout(hotIdleTimer);
    beginHostWork();
    // Min-dwell so the flash is visible, and only if no real rebuild is in
    // flight: the city's own build owns the final status then.
    hotIdleTimer = setTimeout(() => {
      hotIdleTimer = 0;
      // Only if nothing else claimed the readout since: a real build owns the
      // status then, and this flash must not end it.
      if (HOST_WORK.peek().busy) endHostWork();
    }, HOT_REBUILD_MIN_DWELL_MS);
  }

  // The CITY says a refresh-routed field moved — it holds the values and knows
  // each field's route. Deriving it here from the app's own signals was the
  // same re-derivation the rebuild half used to do.
  // No arming: onRoute reports a TRANSITION and does not fire on subscribe, so
  // there is no initial call to suppress. The flag this replaces existed only
  // because a signals effect runs the moment you create it.
  const unsubRefresh = city.settings.onRoute(ChangeRoute.Refresh, () => flagRefresh());

  return function dispose() {
    if (hotIdleTimer) {
      clearTimeout(hotIdleTimer);
      hotIdleTimer = 0;
    }
    unsubRefresh();
  };
}
