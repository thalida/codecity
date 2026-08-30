// router/useSourceUrl.ts — the open project, reflected into the URL. A
// reaction, not state, and mounted rather than run on import: it NAVIGATES, and
// a module-level effect that navigates fires on any import that reaches it.

import { useSignalEffect } from '@preact/signals';
import { sameSourceIdentity } from '@codecity/city';

import { CURRENT_SOURCE } from '@/state/source';
import { URL_PARAMS, VIEW_PARAMS } from '@/router/params';
import { ROUTE_PATH, ROUTE_SEARCH, navigate, hrefFor } from '@/router/location';
import { ROUTES } from '@/router/paths';

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
export function useSourceUrl(): void {
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
