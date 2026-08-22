// router/urlBinding.ts — the URL as an adapter over ONE project: it reflects
// that session's source into ?src/?branch, loads whatever the address bar
// names, and binds the view params on top. Attached to the session the address
// bar is describing, which is exactly one of them — a side-by-side view would
// attach it to the focused column, or to none and say where it is another way.

import { URL_PARAMS } from '@/constants/urlParams';
import { VIEW_PARAMS } from '@/router/params';
import { ROUTES } from '@/router/paths';
import { navigate, hrefFor, ROUTE_SEARCH, ROUTE_PATH } from '@/router/location';
import { effect } from '@preact/signals';
import { attachViewUrlReactions } from '@/router/viewBinding';
import type { ProjectSession } from '@/state/project/session';

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
function attachSourceReflection(session: ProjectSession): () => void {
  return effect(() => {
    const cur = session.source.current.value;
    if (!cur) return;
    const params = new URLSearchParams(ROUTE_SEARCH.peek());
    // A different project than the URL was describing: its mode, scrub commit
    // and selection belong to the one that just left.
    const had = params.get(URL_PARAMS.SRC);
    if (had && !session.source.isOpen(had, params.get(URL_PARAMS.BRANCH))) {
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

/** Point the address bar at `session`, both ways. Returns a dispose. */
export function attachUrlBinding(session: ProjectSession): () => void {
  const stops = [
    attachSourceReflection(session),
    session.load.attachRouteLoad(),
    attachViewUrlReactions(session),
  ];
  return () => stops.forEach((stop) => stop());
}
