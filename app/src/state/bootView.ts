// state/bootView.ts — the cold-boot picker decision, run synchronously before
// the first paint (see main.tsx). Deciding it here rather than in an App effect
// means the opaque full-page landing is present on frame one and covers the
// chrome, instead of the chrome flashing for a frame before the effect opens it.
//
// No ?src → open the picker. A remote ?src with no ?branch → open it prefilled
// (the branch choice is explicit; the manifest hook won't auto-load it). A ?src
// that can auto-load opens nothing here (the loading overlay owns that path).

import { openProjectsView } from '@/state/stores/ui';
import { URL_PARAMS } from '@/constants/urlParams';
import { srcNeedsBranch } from '@/utils/sources';

export function openBootPickerIfNeeded(): void {
  const qp = new URLSearchParams(window.location.search);
  const src = qp.get(URL_PARAMS.SRC);
  const branch = qp.get(URL_PARAMS.BRANCH) ?? undefined;
  if (!src) {
    openProjectsView({ dismissible: false });
  } else if (srcNeedsBranch(src, branch)) {
    openProjectsView({ dismissible: false, prefill: { src } });
  }
}
