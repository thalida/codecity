// city/components/onSettings.ts — subscribe a component's reactivity to a single
// settings store. Runs `apply` once immediately and again on every Save of
// `store`, and ONLY that store: `apply` is invoked untracked, so any other
// signals it reads (picker hover/selection, sibling stores, computeds derived
// from `store`) do NOT become dependencies (which would over-fire the effect).
// Returns the effect's stop fn.
//
// Use this ONLY for components whose theme reactivity tracks exactly one store.
// A component that genuinely wants to re-fire on TWO stores (e.g. repoLabel,
// which reads both REPO_LABEL and BUILDING_DIMENSIONS) does NOT fit here —
// wrapping its apply untracked would silently drop the second subscription.
import { effect, untracked, type ReadonlySignal } from '@preact/signals';

export function onSettings(store: ReadonlySignal<unknown>, apply: () => void): () => void {
  return effect(() => {
    void store.value; // the ONLY tracked dependency
    untracked(apply);
  });
}
