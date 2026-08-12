// state/bootView.ts — the cold-boot picker decision, run synchronously before
// the first paint (see main.tsx). Deciding it here rather than in an App effect
// means the opaque full-page landing is present on frame one and covers the
// chrome, instead of the chrome flashing for a frame before the effect opens it.
//
// No ?src → open the picker. Any ?src loads, branch or not: the server resolves
// origin's default when none is pinned, so a bare ?src is a complete request
// and the loading overlay owns that path.

import { openProjectsView } from '@/state/stores/ui';
import { URL_PARAMS } from '@/constants/urlParams';

export function openBootPickerIfNeeded(): void {
  const qp = new URLSearchParams(window.location.search);
  if (!qp.get(URL_PARAMS.SRC)) {
    openProjectsView({ dismissible: false });
  }
}
