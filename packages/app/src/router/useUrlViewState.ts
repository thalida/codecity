// router/useUrlViewState.ts — the page URL as one <City> prop pair.
//
// The URL says where to be; that is the `viewState` prop. The city says where
// it went; that is `onViewStateChange`, written straight back. There is no
// third copy of the view, nothing here reads back out of a city, and nothing
// compares the two: the component drops an echo of its own report, which is
// what makes reflecting every change back in safe.

import { useCallback } from 'preact/hooks';
import { useComputed } from '@preact/signals';
import type { CityViewState } from '@codecity/city';
import { encodeSelection, decodeSelection } from '@codecity/city';

import { VIEW_PARAMS, TIMELINE_MODE_PARAM } from '@/router/params';
import { ROUTE_PARAMS, setRouteParams, type NavigateOptions } from '@/router/location';

// Replace-only: neither a scrub nor a click is a place the reader asked to go,
// and a drag would otherwise bury their history under a hundred entries.
const REPLACE: NavigateOptions = { replace: true };

/** The view the current URL is asking for. */
export function readViewState(qp: URLSearchParams): CityViewState {
  const timeline = qp.get(VIEW_PARAMS.MODE) === TIMELINE_MODE_PARAM;
  const commit = qp.get(VIEW_PARAMS.COMMIT);
  return {
    selection: decodeSelection(qp.get(VIEW_PARAMS.SELECTION)),
    timeline: timeline ? { mode: true, ...(commit ? { commit } : {}) } : null,
  };
}

/** Write a view into the URL, dropping what does not apply. */
export function writeViewState(view: CityViewState): void {
  const timeline = !!view.timeline?.mode;
  setRouteParams((params) => {
    setOrDelete(params, VIEW_PARAMS.MODE, timeline ? TIMELINE_MODE_PARAM : null);
    // A commit only means something in Timeline: back in Live you are at HEAD,
    // so it leaves with the mode.
    setOrDelete(params, VIEW_PARAMS.COMMIT, timeline ? (view.timeline?.commit ?? null) : null);
    setOrDelete(params, VIEW_PARAMS.SELECTION, encodeSelection(view.selection ?? null));
  }, REPLACE);
}

function setOrDelete(params: URLSearchParams, key: string, value: string | null): void {
  if (value === null) params.delete(key);
  else params.set(key, value);
}

/** Change one part of the view the URL names, leaving the rest of it alone.
 *  Every chrome control that moves the reader goes through here: the URL is
 *  where the view lives, and the city follows it down as a prop. */
export function updateViewState(patch: Partial<CityViewState>): void {
  writeViewState({ ...readViewState(ROUTE_PARAMS.peek()), ...patch });
}

/** Enter or leave Timeline. Entering at a commit rests the scrubber there. */
export function setUrlTimelineMode(on: boolean, commit?: string): void {
  updateViewState({ timeline: on ? { mode: true, ...(commit ? { commit } : {}) } : null });
}

/** `[viewState, onViewStateChange]` for a <City>. */
export function useUrlViewState(): [CityViewState, (next: CityViewState) => void] {
  const view = useComputed(() => readViewState(ROUTE_PARAMS.value));
  return [view.value, useCallback(writeViewState, [])];
}
