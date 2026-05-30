// state/runtime/sourceContext.ts — Stable short hash of a source identity (src + branch),
// plus a single nanostore atom that tracks which source is currently
// loaded. Other modules (selection persistence, camera-pose persistence)
// subscribe to CURRENT_SOURCE_KEY to swap their localStorage slots when
// the user picks a different source.

import { atom } from 'nanostores';

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36); // unsigned, base-36 — ~6-7 chars
}

/**
 * Compute a short stable hash for a (src, branch) pair. Used to namespace
 * per-source state (selection, camera pose) in localStorage.
 *
 * The hash distinguishes (src, undefined) from (src, ""), but in practice
 * we treat empty-string branch as "no branch" — callers should pass undefined.
 */
export function sourceKey(src: string, branch?: string): string {
  return djb2(`${src}\0${branch ?? ''}`);
}

/**
 * The currently-loaded source's hash, or null when no source is loaded
 * (modal-open / first boot). Set by main.ts boot and on every successful
 * modal submit.
 */
export const CURRENT_SOURCE_KEY = atom<string | null>(null);
