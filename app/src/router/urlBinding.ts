// router/urlBinding.ts — the URL as an adapter over ONE project: it reflects
// that session's source into ?src/?branch, loads whatever the address bar
// names, and binds the view params on top. Attached to the session the address
// bar describes, which is one of them: a column view attaches it to none.

import { URL_PARAMS } from '@/constants/urlParams';
import { VIEW_PARAMS } from '@/router/params';
import { ROUTES } from '@/router/paths';
import { navigate, hrefFor, ROUTE_SEARCH, ROUTE_PATH, ROUTE_PARAMS } from '@/router/location';
import { computed, effect } from '@preact/signals';
import { attachViewUrlReactions } from '@/router/viewBinding';
import { readUrlView } from '@/router/viewParams';
import { sourceIdentity } from '@/utils/sources';
import type { CitySession } from '@/city/session/session';

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
 *  the load began at home. Exported for the view-params tests beside it. */
export function attachSourceReflection(session: CitySession): () => void {
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

/** What the address bar asks for, as one comparable string: a computed notifies
 *  only when THAT changes, so writing ?sel= or ?mode= cannot re-ask it. */
const URL_SOURCE = computed(() => {
  if (ROUTE_PATH.value !== ROUTES.CITY) return '';
  const view = readUrlView(ROUTE_PARAMS.value);
  return view.src ? sourceIdentity(view.src, view.branch) : '';
});

/** Follow the URL into `session`: the boot read and every later Back/Forward.
 *  A bare ?src is complete; the server resolves the default branch. */
export function attachRouteLoad(session: CitySession): () => void {
  // Whether the URL named a city on the last run, so this one can tell arriving
  // at one from moving around inside it.
  let onCityRoute = false;
  return effect(() => {
    if (!URL_SOURCE.value) {
      onCityRoute = false;
      return;
    }
    const arriving = !onCityRoute;
    onCityRoute = true;
    // Peeked: the identity above is the trigger, and re-reading the params here
    // must not subscribe this to the view ones alongside it.
    const asked = readUrlView(ROUTE_PARAMS.peek());
    // Out of the tracking scope: the load writes signals this effect reads.
    queueMicrotask(() => {
      // Arriving always asks: only the server knows if its scan still holds.
      // Once here, that city again is the branch a commit put in the URL.
      if (!arriving && session.source.isOpen(asked.src, asked.branch)) return;
      void session.load.boot(asked);
    });
  });
}

/** Point the address bar at `session`, both ways. Returns a dispose. */
export function attachUrlBinding(session: CitySession): () => void {
  const stops = [
    attachSourceReflection(session),
    attachRouteLoad(session),
    attachViewUrlReactions(session),
  ];
  return () => stops.forEach((stop) => stop());
}
