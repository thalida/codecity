// router/cityUrl.ts — this app's URL contract for a city, in one place.
//
// One query string, two things: what to LOAD and WHERE YOU ARE in it. useCityUrl
// reads both; the reflection below is separate, being an effect rather than a read.

import { useCallback } from 'preact/hooks';
import { useComputed, useSignalEffect } from '@preact/signals';
import {
  identityBranch,
  sameSourceIdentity,
  encodeSelection,
  decodeSelection,
  type CityViewState,
} from '@codecity/city';

import { CURRENT_SOURCE } from '@/state/source';
import { URL_PARAMS, VIEW_PARAMS, TIMELINE_MODE_PARAM } from '@/router/params';
import {
  ROUTE_PARAMS,
  ROUTE_PATH,
  ROUTE_SEARCH,
  navigate,
  hrefFor,
  setRouteParams,
  type NavigateOptions,
} from '@/router/location';
import { ROUTES } from '@/router/paths';

// Replace-only: neither a scrub nor a click is a place the reader asked to go,
// and a drag would bury their history under a hundred entries.
const REPLACE: NavigateOptions = { replace: true };

// ── What the URL says ────────────────────────────────────────────────

/** What the URL says to show. */
export interface UrlSource {
  src: string;
  branch: string | undefined;
  noCache: boolean;
}

function readUrlSource(qp: URLSearchParams): UrlSource | null {
  const src = qp.get(URL_PARAMS.SRC);
  if (!src) return null;
  return {
    src,
    // Normalized the way a load commits it, or a local source opened with a
    // stale ?branch would never match the source that loaded.
    branch: identityBranch(src, qp.get(URL_PARAMS.BRANCH) ?? undefined),
    noCache: qp.get(URL_PARAMS.NO_CACHE) === 'true',
  };
}

/** The view the current URL is asking for. */
function readViewState(qp: URLSearchParams): CityViewState {
  const timeline = qp.get(VIEW_PARAMS.MODE) === TIMELINE_MODE_PARAM;
  const commit = qp.get(VIEW_PARAMS.COMMIT);
  return {
    selection: decodeSelection(qp.get(VIEW_PARAMS.SELECTION)),
    timeline: timeline ? { mode: true, ...(commit ? { commit } : {}) } : null,
  };
}

/** Write a view into the URL, dropping what does not apply. */
function writeViewState(view: CityViewState): void {
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

/** Change one part of the view the URL names, leaving the rest alone. Every
 *  chrome control that moves the reader goes through here. */
export function updateViewState(patch: Partial<CityViewState>): void {
  writeViewState({ ...readViewState(ROUTE_PARAMS.peek()), ...patch });
}

/** Enter or leave Timeline. Entering at a commit rests the scrubber there. */
export function setUrlTimelineMode(on: boolean, commit?: string): void {
  updateViewState({ timeline: on ? { mode: true, ...(commit ? { commit } : {}) } : null });
}

/** Everything a <City> needs off the URL: what to show, and where to be. */
export interface CityUrl {
  source: UrlSource | null;
  viewState: CityViewState;
  onViewStateChange: (next: CityViewState) => void;
}

export function useCityUrl(): CityUrl {
  const source = useComputed(() => readUrlSource(ROUTE_PARAMS.value)).value;
  const viewState = useComputed(() => readViewState(ROUTE_PARAMS.value)).value;
  return { source, viewState, onViewStateChange: useCallback(writeViewState, []) };
}

// ── What this app writes back ────────────────────────────────────────

/** Drop the load from the URL and go home: a cancel with nothing to fall back
 *  to must not leave a reload re-running what it called off. */
export function clearSourceUrl(): void {
  // Anything the app does not own (an ?utm_source, say) rides along home: only
  // the params describing the load that was called off are dropped.
  const params = new URLSearchParams(ROUTE_SEARCH.peek());
  for (const key of [...Object.values(URL_PARAMS), ...Object.values(VIEW_PARAMS)]) {
    params.delete(key);
  }
  navigate(hrefFor(ROUTES.HOME, params), { replace: true });
}

/** Reflect the applied source so reload/share reopens it, moving to /city if
 *  the load began at home. */
export function usePublishSourceToUrl(): void {
  useSignalEffect(() => {
    const cur = CURRENT_SOURCE.value;
    if (!cur) return;
    const params = new URLSearchParams(ROUTE_SEARCH.peek());
    // A different project than the URL was describing: its mode, scrub commit
    // and selection belong to the one that just left.
    const had = params.get(URL_PARAMS.SRC);
    if (
      had &&
      !sameSourceIdentity({ src: had, branch: params.get(URL_PARAMS.BRANCH) ?? undefined }, cur)
    ) {
      for (const key of Object.values(VIEW_PARAMS)) params.delete(key);
    }
    params.set(URL_PARAMS.SRC, cur.src);
    if (cur.branch) params.set(URL_PARAMS.BRANCH, cur.branch);
    else params.delete(URL_PARAMS.BRANCH);
    // From the switcher this is a place you went, so it pushes and Back returns
    // to the list; already on /city (a re-scan, a deep link) is the same place.
    const fromHome = ROUTE_PATH.peek() === ROUTES.HOME;
    navigate(hrefFor(ROUTES.CITY, params), { replace: !fromHome });
  });
}
