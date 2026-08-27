// city/events.ts — what a city tells whoever is driving it. One emitter per
// instance, so a wallpaper's build cannot move the overlay above the project
// the reader is looking at: the two cities emit to their own subscribers.
//
// Every event is a statement of fact about this city. None of them says what
// the consumer should DO about it — no overlay, no chrome, no store. That
// decision belongs to whoever mounted the canvas.

import type { BuildStage } from './types/build';
import type { PickTarget } from './types/picker';

export interface CityEvents {
  /** A build began, with the stages it will run through, in order. A consumer
   *  that knows the whole list can show a denominator from the first frame. */
  'build:start': { stages: readonly BuildStage[] };
  /** The build moved on to a stage of that list. */
  'build:stage': { stage: BuildStage };
  /** How far through the current stage, 0-100. Only the pack measures itself. */
  'build:progress': { percent: number };
  /** The city is ON SCREEN: the meshes exist and a frame carrying them has been
   *  presented. Not when applyManifest resolves — see render/LOADING.md. */
  'build:done': Record<string, never>;
  'build:error': { error: unknown };
  /** What the POINTER is over, the moment it resolves — not the debounced
   *  hover the outlines settle on, and never a programmatic one: this is the
   *  event a cursor-following tooltip wants. Null is "nothing under it". */
  hover: { target: PickTarget | null };
  /** What is picked, however it got picked: a click, a tree row, a deep link.
   *  Null is "nothing selected". */
  select: { target: PickTarget | null };
}

export type CityEventName = keyof CityEvents;

export type CityListener<K extends CityEventName> = (payload: CityEvents[K]) => void;

export interface CityEmitter {
  /** Subscribe. Returns the unsubscribe; calling it twice is harmless. */
  on<K extends CityEventName>(name: K, listener: CityListener<K>): () => void;
  emit<K extends CityEventName>(name: K, payload: CityEvents[K]): void;
  /** Drop every listener, so a disposed city cannot call into a torn-down view. */
  clear(): void;
}

export function createEmitter(): CityEmitter {
  const listeners = new Map<CityEventName, Set<CityListener<CityEventName>>>();

  return {
    on(name, listener) {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(listener as CityListener<CityEventName>);
      return () => void set.delete(listener as CityListener<CityEventName>);
    },
    emit(name, payload) {
      const set = listeners.get(name);
      if (!set) return;
      // Over a copy: a listener that unsubscribes itself (the one-shot waits)
      // would otherwise mutate the set mid-iteration.
      for (const listener of [...set]) {
        (listener as CityListener<typeof name>)(payload);
      }
    },
    clear() {
      listeners.clear();
    },
  };
}
