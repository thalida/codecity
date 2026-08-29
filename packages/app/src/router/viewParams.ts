// router/viewParams.ts — the query string's vocabulary, both directions: what a
// URL asks for (source, mode, where in history, what is selected) and how a
// selection is written back. Pure, and free of the reaction layer: the fetch
// layer decodes here, and going through viewUrl would make a cycle of it.

// Encoding a selection is the package's: it owns the shape, and two hosts
// inventing their own would produce links that work in only one of them.
import { encodeSelection, decodeSelection } from '@codecity/city';
export { encodeSelection, decodeSelection };
import { PickerSelectionKey } from '@codecity/city';
import { URL_PARAMS } from '@/router/params';
import { VIEW_PARAMS, TIMELINE_MODE_PARAM } from '@/router/params';
import { identityBranch } from '@codecity/city';

/** The view a URL is asking for. */
export interface UrlView {
  src: string | null;
  branch: string | undefined;
  timeline: boolean;
  /** Sha to rest on in Timeline; null is the present. */
  commit: string | null;
  selection: PickerSelectionKey | null;
}

/** Read a view off an explicit param set: a reaction hands in the params it
 *  just reacted to, rather than re-peeking a signal mid-change. */
export function readUrlView(qp: URLSearchParams): UrlView {
  const src = qp.get(URL_PARAMS.SRC);
  return {
    src,
    // Normalized the way a load commits it, or a local source opened with a
    // stale ?branch would never match the source that loaded.
    branch: src ? identityBranch(src, qp.get(URL_PARAMS.BRANCH) ?? undefined) : undefined,
    timeline: qp.get(VIEW_PARAMS.MODE) === TIMELINE_MODE_PARAM,
    commit: qp.get(VIEW_PARAMS.COMMIT),
    selection: decodeSelection(qp.get(VIEW_PARAMS.SELECTION)),
  };
}
