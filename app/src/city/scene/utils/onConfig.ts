// city/scene/utils/onConfig.ts — subscribe a component to ONE section of its
// city's config (ctx.config.STREETS, say). Runs `apply` now and on every change
// to that section, and only that one: `apply` runs untracked, so anything else
// it reads (picker hover, a sibling section, a computed off this one) does NOT
// become a dependency, which would over-fire it.
//
// So use it only where the reactivity really is one section. A component that
// wants two (repoLabel reads REPO_LABEL and BUILDING_DIMENSIONS) does not fit:
// untracking its apply would silently drop the second subscription.
import { effect, untracked, type ReadonlySignal } from '@preact/signals';

export function onConfig(store: ReadonlySignal<unknown>, apply: () => void): () => void {
  return effect(() => {
    void store.value; // the ONLY tracked dependency
    untracked(apply);
  });
}
