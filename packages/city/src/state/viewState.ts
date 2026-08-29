// city/viewState.ts — everything about WHERE you are in a city, as one value
// you can write down and hand back.
//
// A host that wants a shareable link, a restored session or an undo stack needs
// exactly this, and without it each one writes its own: our own app spends
// router/viewBinding.ts and router/viewParams.ts serialising the selection and
// the scrub position into the URL by hand, which is a snapshot API written by
// the consumer because the package had none.
//
// Deliberately NOT the settings. Those are values the host already owns and
// persists; this is the part of a city's state that the city itself holds.

import type { PickerSelectionKey } from '../types/picker';

/** Where you are in a city. Plain data: JSON in, JSON out, no class, nothing
 *  that has to be alive to be meaningful. Every field is optional, and an
 *  absent one means "leave this as it is" on the way back in — so a host that
 *  only cares about the selection writes only the selection. */
export interface CityViewState {
  /** What is selected, by identity rather than by mesh, so it survives the
   *  rebuild between writing it down and reading it back. */
  selection?: PickerSelectionKey | null;
  /** Timeline: whether it is on, and where the scrubber sits. Absent when the
   *  city is showing HEAD. */
  timeline?: {
    mode: boolean;
    /** A float commit index — the scrub interpolates between commits. */
    pos: number;
  } | null;
}

// ── A selection as a string ──────────────────────────────────────────────
// For a host that has to STORE one: a link, a session, a list of bookmarks.
// The shape being encoded is ours, so the encoding is too.
//
// It is a value encoding and nothing else. WHERE a host puts the string is the
// host's business — a query param, a path segment, localStorage — and the
// package has no way to have an opinion about it: a page showing two cities has
// one address bar and two selections.

import { NodeKind } from '../types/manifest';

const WORD_FOR: Partial<Record<NodeKind, string>> = {
  [NodeKind.File]: 'file',
  [NodeKind.Directory]: 'dir',
  [NodeKind.Commit]: 'commit',
};
const KIND_FOR: Record<string, NodeKind> = {
  file: NodeKind.File,
  dir: NodeKind.Directory,
  commit: NodeKind.Commit,
};

/** A selection as one string, or null when there is nothing selected. */
export function encodeSelection(key: PickerSelectionKey | null): string | null {
  if (!key) return null;
  const word = WORD_FOR[key.kind];
  if (!word) return null;
  return `${word}:${key.kind === NodeKind.Commit ? key.sha : key.path}`;
}

/** The selection a string names, or null when it names nothing we know — so a
 *  stale or hand-edited link resolves to nothing rather than throwing. */
export function decodeSelection(raw: string | null): PickerSelectionKey | null {
  if (!raw) return null;
  const at = raw.indexOf(':');
  if (at <= 0) return null;
  const kind = KIND_FOR[raw.slice(0, at)];
  const value = raw.slice(at + 1);
  if (!kind || !value) return null;
  return kind === NodeKind.Commit
    ? { kind, sha: value }
    : ({ kind, path: value } as PickerSelectionKey);
}
