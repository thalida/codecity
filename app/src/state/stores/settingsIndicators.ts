// state/stores/settingsIndicators.ts — "how customized is this render" signals
// that drive the Settings badge (a total count) and the per-tab change dots.
//
// A setting counts as changed when its committed value differs from its
// registered default. Excludes aren't settings-draft stores, so they're folded
// in explicitly against the Scan tab (and the total). Per-tab grouping mirrors
// the ControlsPane subtabs: Scan = live-updates + excludes, Appearance = the
// three theme pickers, World = every other registered store.

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

function anyChanged(stores: AnyStore[]): boolean {
  return stores.some((s) => changedFieldCount(s) > 0);
}

/** Total settings changed from default across every tab, plus the exclude count.
 *  Drives the count badge on the Settings activity-bar entry. */
export const CHANGED_SETTINGS_COUNT = computed(() => {
  let n = 0;
  forEachSettingStore((store) => {
    n += changedFieldCount(store);
  });
  return n + ACTIVE_EXCLUDES.value.length;
});

/** Scan tab has a change: live-update settings differ, or something is excluded. */
export const SCAN_CHANGED = computed(
  () => anyChanged(SCAN_STORES) || ACTIVE_EXCLUDES.value.length > 0
);

/** Appearance tab has a change: any of the three theme pickers differ. */
export const APPEARANCE_CHANGED = computed(() => anyChanged(APPEARANCE_STORES));

/** World tab has a change: any registered store that isn't a Scan/Appearance
 *  store differs. Derived from the registry so new World stores are covered
 *  without listing them here. */
export const WORLD_CHANGED = computed(() => {
  let changed = false;
  forEachSettingStore((store) => {
    if (SCAN_STORES.includes(store) || APPEARANCE_STORES.includes(store)) return;
    if (changedFieldCount(store) > 0) changed = true;
  });
  return changed;
});
