// city/events.ts — what a city tells whoever is driving it. One emitter per
// instance, so a wallpaper's build cannot move the overlay above the project
// the reader is looking at: the two cities emit to their own subscribers.
//
// Every event is a statement of fact about this city. None of them says what
// the consumer should DO about it — no overlay, no chrome, no store. That
// decision belongs to whoever mounted the canvas.

import type { BuildStage } from '../types/build';
import type { PickTarget } from '../types/picker';
import type { ScanPhase, ScanProgressEvent } from '../client/manifest';
import type { Manifest } from '../types/manifest';
import type { TimelineProgress } from '../types/timeline';

export interface CityEvents {
  /** This city started loading a repo. Everything below until scan:done or
   *  scan:error belongs to this load. */
  'scan:start': { src: string; branch?: string };
  /** The server's own account of what it is doing: cloning at a percent, or
   *  scanning at a file count. Passed through rather than restated, because
   *  the consumer's readout is written against these phases already. */
  'scan:progress': { event: ScanProgressEvent };
  /** What to call this repo, as soon as anything knows: the server's label
   *  first, then the scanned tree's own name. */
  'scan:label': { label: string };
  /** A manifest arrived and has been applied to this city. A scan sends a
   *  skeleton first and the complete tree after, so this fires more than once. */
  'scan:manifest': { manifest: Manifest; phase: ScanPhase };
  /** The load finished, carrying the manifest the city settled on. */
  'scan:done': { manifest: Manifest };
  'scan:error': { error: unknown };
  /** Assembling this repo's history: the server walking commits and resolving
   *  blobs, then the client replaying them. Timeline is a way of showing a
   *  city, not a feature of any one host, so its progress is reported like any
   *  other work a city does. */
  /** A read of this repo's HISTORY has begun. Not a scan: it fetches the
   *  commit graph and replays blobs, and a host drawing a readout needs to know
   *  which of the two it is describing. */
  'timeline:start': { src: string; branch?: string };
  'timeline:progress': { event: TimelineProgress };
  /** The history stream ended. The union city still has to be packed, which
   *  build:done reports. */
  'timeline:done': Record<string, never>;
  /** The read failed. Separate from scan:error for the same reason the start
   *  is: a host showing what went wrong should know which it was. */
  'timeline:error': { error: unknown };
  /** A build began, with the stages it will run through, in order. A consumer
   *  that knows the whole list can show a denominator from the first frame. */
  'build:start': { stages: readonly BuildStage[] };
  /** The build moved on to a stage of that list. */
  'build:stage': { stage: BuildStage };
  /** How far through the current stage, 0-100. Only the pack measures itself. */
  'build:progress': { percent: number };
  /** The city is ON SCREEN: the meshes exist and a frame carrying them has been
   *  presented. Not when applyManifest resolves — see render/LOADING.md.
   *
   *  `pending` is what the manifest THIS build drew says is still to come, and
   *  it is the difference between "a city is up" and "the city is finished".
   *  A scan streams more than once: the first manifest draws real buildings
   *  while history is still coming, and history is where commits come from, so
   *  the trees land on a later build. A consumer that treats the first done as
   *  the last one reveals a city that then grows a forest. Empty means final. */
  'build:done': { pending: Manifest['pending'] };
  'build:error': { error: unknown };
  /** What the POINTER is over, the moment it resolves — not the debounced
   *  hover the outlines settle on, and never a programmatic one: this is the
   *  event a cursor-following tooltip wants. Null is "nothing under it". */
  hover: { target: PickTarget | null };
  /** What is picked, however it got picked: a click, a tree row, a deep link.
   *  Null is "nothing selected". */
  select: { target: PickTarget | null };
  /** The reader picked something in the canvas. Fires on every completed pick,
   *  including re-picking what is already picked — which `select` does not,
   *  because nothing changed. That re-pick is how you get back to a details
   *  pane you closed, so it has to be an event about the INPUT, not the state. */
  pick: { target: PickTarget | null };
  /** The reader asked the CITY to look at something — the focus key, not a
   *  consumer calling `focus()`, which already knows it asked. Whoever draws
   *  chrome over this canvas gets to decide what that means for it. */
  focus: { target: PickTarget | null };
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
