// state/bootView.ts — what the URL asks the page to open with: the source, the
// mode, where in history, and what was selected. Read by the boot load (which
// mode's call to make), by the reflection that keeps it up to date, and by the
// pre-paint picker decision below.

import {
  URL_PARAMS,
  VIEW_PARAMS,
  TIMELINE_MODE_PARAM,
  SELECTION_KIND_PARAMS,
} from '@/constants/urlParams';
import { ROUTES } from '@/constants/routes';
import { ROUTE_PARAMS, ROUTE_PATH, navigate, hrefFor } from '@/state/route';
import { identityBranch } from '@/utils/sources';
import { NodeKind } from '@/types';
import type { PickerSelectionKey } from '@/types';

export interface BootView {
  src: string | null;
  branch: string | undefined;
  timeline: boolean;
  /** Sha to rest on in Timeline; null is the present. */
  commit: string | null;
  selection: PickerSelectionKey | null;
}

/** `<kind>:<path|sha>`, or null when the param is absent or unreadable — a link
 *  someone hand-edited badly leaves you on a working city, not an error. */
export function parseSelection(raw: string | null): PickerSelectionKey | null {
  if (!raw) return null;
  const split = raw.indexOf(':');
  if (split <= 0) return null;
  const kind = raw.slice(0, split);
  const value = raw.slice(split + 1);
  if (!value) return null;
  if (kind === SELECTION_KIND_PARAMS[NodeKind.File]) return { kind: NodeKind.File, path: value };
  if (kind === SELECTION_KIND_PARAMS[NodeKind.Directory]) {
    return { kind: NodeKind.Directory, path: value };
  }
  if (kind === SELECTION_KIND_PARAMS[NodeKind.Commit]) return { kind: NodeKind.Commit, sha: value };
  return null;
}

export function readBootView(): BootView {
  const qp = ROUTE_PARAMS.peek();
  const src = qp.get(URL_PARAMS.SRC);
  return {
    src,
    // Normalized the way a load commits it, or a local source opened with a
    // stale ?branch would never match the source that loaded.
    branch: src ? identityBranch(src, qp.get(URL_PARAMS.BRANCH) ?? undefined) : undefined,
    timeline: qp.get(VIEW_PARAMS.MODE) === TIMELINE_MODE_PARAM,
    commit: qp.get(VIEW_PARAMS.COMMIT),
    selection: parseSelection(qp.get(VIEW_PARAMS.SELECTION)),
  };
}

// Runs pre-paint (main.tsx) so the first render is already on the right route.
// A bare ?src is complete: the server resolves origin's default branch.
export function normalizeBootRoute(): void {
  const params = ROUTE_PARAMS.peek();
  const hasSrc = !!params.get(URL_PARAMS.SRC);
  const path = ROUTE_PATH.peek();
  // Links from before /city existed carry ?src at the root.
  if (hasSrc && path !== ROUTES.CITY) navigate(hrefFor(ROUTES.CITY, params), { replace: true });
  // /city describes a project; without one there is nothing for it to show.
  else if (!hasSrc && path !== ROUTES.HOME) navigate(ROUTES.HOME, { replace: true });
}
