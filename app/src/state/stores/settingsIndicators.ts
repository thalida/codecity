// state/stores/settingsIndicators.ts — "how customized is this render": the
// dirty dot on the Settings activity-bar icon.
//
// A setting counts as changed when its committed value differs from its
// registered default. Only what the Settings pane can take you to counts —
// stores that live in a chrome-bar popover are excluded by name, since the
// dot's whole job is pointing at the pane.

import { computed } from '@preact/signals';
import { forEachSettingStore, getFieldKeys } from '@/state/settingsSchema';
import { getDefault } from '@/state/persist';
import { deepEqual } from '@/utils/deep';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';
import { ACCENT_THEME, SURFACE_THEME } from '@/state/stores/settings/theme';
import { SYNTAX_THEME } from '@/state/stores/settings/syntaxTheme';

type AnyStore = { value: unknown };

/** Registered, but not in the Settings pane: scan settings live in the header's
 *  scan menu, appearance in the footer's. Listed so the "everything else" rule
 *  below can't sweep them back into a count they aren't reachable from. */
const POPOVER_STORES: AnyStore[] = [
  LIVE_UPDATES as AnyStore,
  ACCENT_THEME as AnyStore,
  SURFACE_THEME as AnyStore,
  SYNTAX_THEME as AnyStore,
];

/** Number of a store's fields that differ from default. Scalar stores (the theme
 *  pickers register no field map) count as one whole value; field-map stores
 *  count per field. Reads `store.value`, so callers inside a computed track it. */
function changedFieldCount(store: AnyStore): number {
  const keys = getFieldKeys(store);
  if (keys.length === 0) {
    return deepEqual(store.value, getDefault(store)) ? 0 : 1;
  }
  const val = store.value as Record<string, unknown>;
  let n = 0;
  for (const k of keys) {
    if (!deepEqual(val[k], getDefault(store, k))) n++;
  }
  return n;
}

/** Changed settings reachable from the Settings pane. Derived from the registry
 *  so a new World store is covered without being listed. */
export const CHANGED_SETTINGS_COUNT = computed(() => {
  let n = 0;
  forEachSettingStore((store) => {
    if (POPOVER_STORES.includes(store)) return;
    n += changedFieldCount(store);
  });
  return n;
});
