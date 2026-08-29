// @codecity/city/preact — reading a city from a component.
//
// A city holds PLAIN VALUES and says when they change. That is right for the
// core — it is what lets the same city drive Vue, or nothing at all — but it
// leaves a Preact host writing the bridge, and a host that writes the bridge
// writes it once per value. Ours grew to fifteen signals across four files
// before anyone noticed they were all the same idea.
//
// So the adapter provides it. These are the equivalent of tldraw's useValue and
// vue-codemirror's refs: subscribe, re-render, unsubscribe on unmount, and get
// the CURRENT answer on the first render rather than a frame later.

import { useCallback, useSyncExternalStore } from 'preact/compat';

import type { City } from '../city';
import type { CityStatus } from '../state/status';
import type { CityChange } from '../state/change';
import type { Manifest } from '../types/manifest';
import type { PickTarget, PickerSelectionKey } from '../types/picker';
import type { TimelineBundle } from '../types/timeline';
import { EMPTY_CITY_STATUS } from '../state/status';

/** Re-render when `subscribe` fires, reading `read` for the value.
 *
 *  useSyncExternalStore rather than useState + useEffect: it reads during
 *  render, so the first paint has the real value instead of a placeholder that
 *  is corrected a frame later — which is the flicker a hand-rolled bridge has
 *  and cannot easily lose. */
function useCityValue<T>(
  city: City | null,
  subscribe: (city: City, onChange: () => void) => () => void,
  read: (city: City) => T,
  fallback: T
): T {
  const sub = useCallback(
    (onChange: () => void) => (city ? subscribe(city, onChange) : () => {}),
    [city, subscribe]
  );
  const snapshot = useCallback(() => (city ? read(city) : fallback), [city, read, fallback]);
  return useSyncExternalStore(sub, snapshot);
}

/** What a change listener has to be told about for THIS value to be re-read. */
const onChangeOf = (part: keyof CityChange) => (city: City, notify: () => void) =>
  city.onChange((change) => {
    if (change[part]) notify();
  });

/** What the city is doing: phase, fraction, whether what is on screen is final.
 *  What a readout binds to. */
export function useCityStatus(city: City | null): CityStatus {
  const subscribe = useCallback((c: City, notify: () => void) => c.onStatus(notify), []);
  const read = useCallback((c: City) => c.status, []);
  return useCityValue(city, subscribe, read, EMPTY_CITY_STATUS);
}

/** The manifest this city is showing. Null before the first apply. */
export function useCityManifest(city: City | null): Manifest | null {
  const subscribe = useCallback(onChangeOf('manifestChanged'), []);
  const read = useCallback((c: City) => c.manifest, []);
  return useCityValue(city, subscribe, read, null);
}

/** What is selected, as the target itself. Null is nothing selected. */
export function useCitySelection(city: City | null): PickTarget | null {
  const subscribe = useCallback(onChangeOf('selectionChanged'), []);
  const read = useCallback((c: City) => c.picker.selection, []);
  return useCityValue(city, subscribe, read, null);
}

/** The selection by IDENTITY, which is what survives a rebuild — so this is
 *  what a URL or a stored session should carry, not the target. */
export function useCitySelectionKey(city: City | null): PickerSelectionKey | null {
  const subscribe = useCallback(onChangeOf('selectionChanged'), []);
  const read = useCallback((c: City) => c.picker.selectionKey, []);
  return useCityValue(city, subscribe, read, null);
}

/** What the pointer is over. Separate from the selection because a cursor
 *  tooltip repaints on it and a details pane does not. */
export function useCityHover(city: City | null): PickTarget | null {
  const subscribe = useCallback(onChangeOf('hoverChanged'), []);
  const read = useCallback((c: City) => c.picker.hover, []);
  return useCityValue(city, subscribe, read, null);
}

/** Where the reader is in this repo's history. One object rather than eight
 *  hooks: they move together, and a component showing a scrubber wants all of
 *  them in the same render. */
export interface CityTimelineView {
  mode: boolean;
  bundle: TimelineBundle | null;
  /** A float commit index, so scrubbing interpolates. */
  pos: number;
  max: number;
  /** The whole commit `pos` lands on. */
  commit: number;
  /** The rest point content fetches key on: follows the scrub but holds still
   *  mid-drag, so dragging a long history does not refetch per commit crossed. */
  settledCommit: number;
  settledPos: number;
  dragging: boolean;
  /** Today, when it is later than the last commit. Null when it is not. */
  todayMs: number | null;
}

const NO_TIMELINE: CityTimelineView = {
  mode: false,
  bundle: null,
  pos: 0,
  max: 0,
  commit: 0,
  settledCommit: 0,
  settledPos: 0,
  dragging: false,
  todayMs: null,
};

/** Last view handed out per city. useSyncExternalStore compares snapshots by
 *  IDENTITY, so a read that built a fresh object every time would report a
 *  change on every render and re-render forever. Every other hook here returns
 *  something the city already holds; this one composes, so it has to remember. */
const LAST_VIEW = new WeakMap<City, CityTimelineView>();

function sameView(a: CityTimelineView, b: CityTimelineView): boolean {
  return (
    a.mode === b.mode &&
    a.bundle === b.bundle &&
    a.pos === b.pos &&
    a.max === b.max &&
    a.commit === b.commit &&
    a.settledCommit === b.settledCommit &&
    a.settledPos === b.settledPos &&
    a.dragging === b.dragging &&
    a.todayMs === b.todayMs
  );
}

export function useCityTimeline(city: City | null): CityTimelineView {
  const subscribe = useCallback(onChangeOf('timelineChanged'), []);
  const read = useCallback((c: City): CityTimelineView => {
    const t = c.timeline;
    const next: CityTimelineView = {
      mode: t.mode,
      bundle: t.bundle,
      pos: t.pos,
      max: t.max,
      commit: t.commit,
      settledCommit: t.settledCommit,
      settledPos: t.settledPos,
      dragging: t.dragging,
      todayMs: t.todayMs,
    };
    const last = LAST_VIEW.get(c);
    if (last && sameView(last, next)) return last;
    LAST_VIEW.set(c, next);
    return next;
  }, []);
  return useCityValue(city, subscribe, read, NO_TIMELINE);
}
