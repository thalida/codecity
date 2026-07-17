// state/stores/settingsIndicators.ts — "how customized is this render" signals.
// Each subtab shows its own count of changed-from-default settings; the Settings
// activity-bar icon shows a single dirty dot (CHANGED_SETTINGS_COUNT > 0).
//
// A setting counts as changed when its committed value differs from its
// registered default. Excludes aren't settings-draft stores, so they're folded
// into the Scan count explicitly. Per-tab grouping mirrors the ControlsPane
// subtabs: Scan = live-updates + excludes, Appearance = the three theme pickers,
// World = every other registered store.

import { computed } from '@preact/signals';
import { forEachSettingStore, getFieldKeys } from '@/state/settingsSchema';
import { getDefault } from '@/state/persist';
import { deepEqual } from '@/utils/deep';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';
import { ACCENT_THEME, SURFACE_THEME } from '@/state/stores/settings/theme';
import { SYNTAX_THEME } from '@/state/stores/settings/syntaxTheme';
import { ACTIVE_EXCLUDES } from '@/state/stores/excludes';

type AnyStore = { value: unknown };

const SCAN_STORES: AnyStore[] = [LIVE_UPDATES as AnyStore];
const APPEARANCE_STORES: AnyStore[] = [
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

function countStores(stores: AnyStore[]): number {
  return stores.reduce((n, s) => n + changedFieldCount(s), 0);
}

/** Scan tab: changed live-update settings + the number of excluded paths. */
export const SCAN_COUNT = computed(() => countStores(SCAN_STORES) + ACTIVE_EXCLUDES.value.length);

/** Appearance tab: changed theme pickers (accent / surface / syntax). */
export const APPEARANCE_COUNT = computed(() => countStores(APPEARANCE_STORES));

/** World tab: every registered store that isn't a Scan/Appearance store.
 *  Derived from the registry so new World stores are covered automatically. */
export const WORLD_COUNT = computed(() => {
  let n = 0;
  forEachSettingStore((store) => {
    if (SCAN_STORES.includes(store) || APPEARANCE_STORES.includes(store)) return;
    n += changedFieldCount(store);
  });
  return n;
});

/** Total across every tab. Drives the dirty dot on the Settings icon. */
export const CHANGED_SETTINGS_COUNT = computed(
  () => SCAN_COUNT.value + APPEARANCE_COUNT.value + WORLD_COUNT.value
);
