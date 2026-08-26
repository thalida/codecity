// router/location.ts — the page URL, as a signal. The single writer of path AND
// query, so nothing else calls pushState/replaceState. wouter renders off the
// hooks at the bottom; effects and pre-paint code read the signals directly,
// which is why the URL lives here rather than in router context.

import { signal, computed } from '@preact/signals';
import type { BaseLocationHook, BaseSearchHook } from 'wouter-preact';
import { ROUTES } from './paths';
import { URL_PARAMS } from '@codecity/city';

function readHref(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** Path + query as one string, the shape wouter's location hook wants. */
export const HREF = signal<string>(readHref());

export const ROUTE_PATH = computed<string>(() => {
  const q = HREF.value.indexOf('?');
  return q === -1 ? HREF.value : HREF.value.slice(0, q);
});

/** Query string WITHOUT the leading '?', which is wouter's searchHook contract. */
export const ROUTE_SEARCH = computed<string>(() => {
  const q = HREF.value.indexOf('?');
  return q === -1 ? '' : HREF.value.slice(q + 1);
});

export const ROUTE_PARAMS = computed<URLSearchParams>(
  () => new URLSearchParams(ROUTE_SEARCH.value)
);

export interface NavigateOptions {
  /** Replace rather than push: what the user never asked to be a destination
   *  (scrub position, selection) must not bury the back button. */
  replace?: boolean;
}

/** Go to a path+query. No-ops when it would not change the URL, so a reflection
 *  effect can fire freely without stacking identical history entries. */
export function navigate(to: string, opts: NavigateOptions = {}): void {
  if (to === HREF.peek()) return;
  if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  HREF.value = to;
}

/** ':' and '/' are legal in a query (RFC 3986 pchar); form encoding escapes them
 *  anyway, and this URL is read and pasted by people. Parsing takes either. */
function queryString(params: URLSearchParams): string {
  return params.toString().replace(/%3A/g, ':').replace(/%2F/g, '/');
}

/** The URL that opens a project. One builder, so a link's href and whatever a
 *  handler would have navigated to cannot describe different repos. */
export function cityHref(src: string, branch?: string): string {
  const params = new URLSearchParams();
  params.set(URL_PARAMS.SRC, src);
  if (branch) params.set(URL_PARAMS.BRANCH, branch);
  return hrefFor(ROUTES.CITY, params);
}

/** Rewrite the query in place, leaving the path alone. The mutator gets the
 *  live params to set/delete on. */
export function setRouteParams(
  mutate: (params: URLSearchParams) => void,
  opts: NavigateOptions = {}
): void {
  const params = new URLSearchParams(ROUTE_SEARCH.peek());
  mutate(params);
  const query = queryString(params);
  navigate(query ? `${ROUTE_PATH.peek()}?${query}` : ROUTE_PATH.peek(), opts);
}

/** Build a href from a path and params, for links and for navigate() callers
 *  that are moving between routes rather than editing the current one. */
export function hrefFor(path: string, params?: URLSearchParams): string {
  const query = params ? queryString(params) : '';
  return query ? `${path}?${query}` : path;
}

/** Back/forward: the browser owns the URL for that beat, so the signal follows
 *  it rather than the other way round. */
export function attachRouteHistory(): () => void {
  const onPopState = () => {
    HREF.value = readHref();
  };
  window.addEventListener('popstate', onPopState);
  return () => window.removeEventListener('popstate', onPopState);
}

/** Put a boot URL on the route it belongs to, before the first render. A bare
 *  ?src is complete: the server resolves origin's default branch. */
export function normalizeBootRoute(): void {
  const params = ROUTE_PARAMS.peek();
  const hasSrc = !!params.get(URL_PARAMS.SRC);
  const path = ROUTE_PATH.peek();
  // Links minted before /city existed carry ?src at the root.
  if (hasSrc && path !== ROUTES.CITY) navigate(hrefFor(ROUTES.CITY, params), { replace: true });
  // /city describes a project; without one there is nothing for it to show.
  else if (!hasSrc && path !== ROUTES.HOME) navigate(ROUTES.HOME, { replace: true });
}

// ── wouter hooks ─────────────────────────────────────────────────────

// Reading .value inside a component subscribes it, so a navigate() anywhere
// re-renders the tree; wouter never holds location state of its own.
export const useRouteLocation: BaseLocationHook = () => [ROUTE_PATH.value, navigate];
export const useRouteSearch: BaseSearchHook = () => ROUTE_SEARCH.value;
