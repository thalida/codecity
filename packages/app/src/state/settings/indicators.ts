// state/settings/indicators.ts — the dirty dot on the Settings icon. Only what
// the pane can take you to counts, since pointing there is the dot's whole job.

import { computed } from '@preact/signals';
import { forEachSettingStore, getFieldKeys } from '@/state/settings/schema';
import { getDefault } from '@/state/persist';
import { deepEqual } from '@/utils/deep';
import { LIVE_UPDATES } from '@/state/settings/values/updates';
import { ACCENT_THEME, SURFACE_THEME } from '@/state/settings/values/theme';
import { SYNTAX_THEME } from '@/state/settings/values/syntaxTheme';

type AnyStore = { value: unknown };

/** Registered but reachable from a chrome-bar popover, not the pane. Listed so
 *  the "everything else" rule below cannot sweep them back in. */
const POPOVER_STORES: AnyStore[] = [
  LIVE_UPDATES as AnyStore,
  ACCENT_THEME as AnyStore,
  SURFACE_THEME as AnyStore,
  SYNTAX_THEME as AnyStore,
];

/** How many of a store's fields differ from default. A scalar store (no field
 *  map) counts as one. Reads store.value, so a calling computed tracks it. */
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
