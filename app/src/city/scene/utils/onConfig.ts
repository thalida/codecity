// city/scene/utils/onConfig.ts — run `apply` now and on every change to ONE
// section of this city's config, and only that one: it runs untracked, so
// nothing else it reads becomes a dependency. Which is why a component that
// wants two sections cannot use this — the second would be dropped silently.
import { effect, untracked, type ReadonlySignal } from '@preact/signals';

export function onConfig(section: ReadonlySignal<unknown>, apply: () => void): () => void {
  return effect(() => {
    void section.value; // the ONLY tracked dependency
    untracked(apply);
  });
}
