// city/change.ts — one notification saying what moved.
//
// A host that re-renders when a city changes does not want eleven events; it
// wants to be told once, and to ask what is different. That is what CodeMirror's
// ViewUpdate is and what tldraw's store diff is, and it is what lets a Vue
// consumer write one `watch` instead of eleven subscriptions it has to keep in
// step with our event list.
//
// The eleven stay. This is the door a UI binds to; they are the detail behind
// it, for a consumer that wants a specific moment rather than a repaint.

import type { CityStatus } from './status';
import type { Manifest } from '../types/manifest';
import type { PickTarget } from '../types/picker';
import type { CityEvents } from './events';

/** What moved since the last notification. Flags rather than a payload: a host
 *  reads the city for the values, and reads this to decide whether to bother. */
export interface CityChange {
  /** What it is doing: phase, fraction, whether the city on screen is final. */
  statusChanged: boolean;
  /** A manifest was applied. The geometry on screen is different. */
  manifestChanged: boolean;
  /** What is selected. */
  selectionChanged: boolean;
  /** What is hovered. Separate from the selection because a host that draws a
   *  cursor tooltip repaints on it and one that draws a details pane does not. */
  hoverChanged: boolean;
  /** The timeline's mode, bundle or scrub position. */
  timelineChanged: boolean;
}

/** What a city hands its change listeners, so a host does not have to reach
 *  back through the handle for the three things it always wants. */
export interface CityChangeContext {
  status: CityStatus;
  manifest: Manifest | null;
  selection: PickTarget | null;
  hover: PickTarget | null;
}

export type CityChangeListener = (change: CityChange, city: CityChangeContext) => void;

const NOTHING: CityChange = {
  statusChanged: false,
  manifestChanged: false,
  selectionChanged: false,
  hoverChanged: false,
  timelineChanged: false,
};

/** Collects what moved and tells listeners once, on a microtask.
 *
 *  Batched deliberately: an apply publishes a manifest, moves the selection and
 *  ends a build within one turn, and a host that re-rendered three times for it
 *  would be doing two renders nobody asked for. */
export interface CityChangeHub {
  on(listener: CityChangeListener): () => void;
  /** Record that something moved. Flushing is this hub's business. */
  mark(part: keyof CityChange): void;
  dispose(): void;
}

export function createChangeHub(read: () => CityChangeContext): CityChangeHub {
  const listeners = new Set<CityChangeListener>();
  let pending: CityChange | null = null;
  let disposed = false;

  function flush(): void {
    const change = pending;
    pending = null;
    if (!change || disposed || listeners.size === 0) return;
    const context = read();
    for (const listener of [...listeners]) listener(change, context);
  }

  return {
    on(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    mark(part) {
      if (disposed) return;
      if (!pending) {
        pending = { ...NOTHING };
        queueMicrotask(flush);
      }
      pending[part] = true;
    },
    dispose() {
      disposed = true;
      pending = null;
      listeners.clear();
    },
  };
}

/** Which of a city's events mark which part. Data rather than a wiring block,
 *  so it reads as a list and an event with no home here is a visible omission
 *  rather than a subscription nobody wrote.
 *
 *  `pick` and `focus` are absent on purpose: both are the reader ASKING for
 *  something, and neither changes what the city holds. The `select` that
 *  usually follows is the change.
 *
 *  So is `scan:manifest`, for a subtler reason: it reports a manifest the
 *  STREAM produced, and a host that calls applyManifest itself never sees one.
 *  The city publishing is the change, so that is what marks it. */
export const CHANGE_FOR_EVENT = {
  hover: 'hoverChanged',
  select: 'selectionChanged',
  'scan:start': 'statusChanged',
  'scan:progress': 'statusChanged',
  'scan:done': 'statusChanged',
  'scan:error': 'statusChanged',
  'build:start': 'statusChanged',
  'build:stage': 'statusChanged',
  'build:progress': 'statusChanged',
  'build:done': 'statusChanged',
  'build:error': 'statusChanged',
} as const satisfies Partial<Record<keyof CityEvents, keyof CityChange>>;
