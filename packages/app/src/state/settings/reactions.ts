// state/settings/reactions.ts — the "rebuilding" flash on a Save the city
// answers by refreshing materials rather than re-packing. See README.md.

import { ChangeRoute } from '@codecity/city';
import type { City } from '@codecity/city';

import { HOST_WORK, beginHostWork, endHostWork } from '@/views/CityView/chrome';

// Min-dwell for the 'rebuilding' indicator on the material-only path.
const HOT_REBUILD_MIN_DWELL_MS = 220;

/** Flash "rebuilding" when a Save lands that the scene answers by refreshing
 *  its materials rather than re-packing. Attach to the SCENE city only: this */
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
  const unsubRefresh = city.settings.onRoute(ChangeRoute.Refresh, () => flagRefresh());

  return function dispose() {
    if (hotIdleTimer) {
      clearTimeout(hotIdleTimer);
      hotIdleTimer = 0;
    }
    unsubRefresh();
  };
}
