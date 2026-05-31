// state/runtime/activeSource.ts — Runtime state for whichever source is currently
// loaded: its short hash (used to namespace per-source localStorage slots) and
// its display info (label, branch, sourceUrl). Always travel together — every
// successful source apply writes both. Live in /runtime/ because they're
// session-only; persistence happens *keyed by* CURRENT_SOURCE_KEY rather than
// re-hydrating these signals.

import { signal } from '@preact/signals';

// ── sourceKey: stable short hash of (src, branch) ────────────────────

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
 * (modal-open / first boot). Set by boot and on every successful modal submit.
 */
export const CURRENT_SOURCE_KEY = signal<string | null>(null);

// ── SourceInfo: display info for the currently-loaded source ─────────

export interface SourceInfo {
  /** Human-readable project label (owner/repo or directory name). */
  label: string;
  /** Branch name when the loaded source is a git URL with a known branch. */
  branch: string | undefined;
  /** Original git URL when the source is a hosted git repo. */
  sourceUrl: string | undefined;
}

export const SOURCE_INFO = signal<SourceInfo>({
  label: '',
  branch: undefined,
  sourceUrl: undefined,
});
