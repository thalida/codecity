// router/useUrlSource.ts — the page URL as <City>'s source props.
//
// Separate from useUrlViewState because these are two contracts that happen to
// share a query string: what to LOAD (src, branch, no_cache) and WHERE YOU ARE
// in what was loaded (mode, commit, sel). A host routing by path, or showing
// two cities with no single ?src to give either, replaces this one and keeps
// the other.
//
// Nothing here guards against re-asking for the project already on screen: the
// props are the values themselves, so writing ?sel= leaves src and branch
// untouched and the load effect never re-runs.

import { useComputed } from '@preact/signals';
import { identityBranch } from '@codecity/city';

import { URL_PARAMS } from '@/router/params';
import { ROUTE_PARAMS } from '@/router/location';

/** What the URL says to show. */
export interface UrlSource {
  src: string;
  branch: string | undefined;
  noCache: boolean;
}

export function readUrlSource(qp: URLSearchParams): UrlSource | null {
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

/** The source the current URL names, or null when it names none. */
export function useUrlSource(): UrlSource | null {
  return useComputed(() => readUrlSource(ROUTE_PARAMS.value)).value;
}
