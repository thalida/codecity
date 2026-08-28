// router/viewParams.ts — the query string's vocabulary, both directions: what a
// URL asks for (source, mode, where in history, what is selected) and how a
// selection is written back. Pure, and free of the reaction layer: the fetch
// layer decodes here, and going through viewUrl would make a cycle of it.

import { URL_PARAMS, NodeKind, PickerSelectionKey } from '@codecity/city';
import { VIEW_PARAMS, TIMELINE_MODE_PARAM, SELECTION_KIND_PARAMS } from '@/router/params';
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
    selection: parseSelection(qp.get(VIEW_PARAMS.SELECTION)),
  };
}

/** A selection as one param value, the shape parseSelection reads back. */
export function selectionParam(key: PickerSelectionKey | null): string | null {
  if (!key) return null;
  const kind = SELECTION_KIND_PARAMS[key.kind];
  return key.kind === NodeKind.Commit ? `${kind}:${key.sha}` : `${kind}:${key.path}`;
}
