// state/stores/source.ts — Everything about *which source is loaded*: the
// current source's stable key + display info, the per-(src,branch) hash used to
// namespace per-source localStorage slots, and the recently-opened list.
//
// CURRENT_SOURCE_KEY / SOURCE_INFO are session-scoped (set on every successful
// source apply; persistence happens *keyed by* CURRENT_SOURCE_KEY rather than
// re-hydrating these). RECENTS is persisted — but that's an implementation
// detail of one field on the same topic, not a separate concern.

import { signal } from '@preact/signals';
import { persistedSignal } from '@/state/persist';
import { PERSISTED_KEYS } from '@/constants/storage';
import { MAX_RECENT_SOURCES } from '@/constants/ui';

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

// ── Currently-loaded source ──────────────────────────────────────────

/**
 * The currently-loaded source's hash, or null when no source is loaded
 * (modal-open / first boot). Set by boot and on every successful modal submit.
 */
export const CURRENT_SOURCE_KEY = signal<string | null>(null);

/**
 * Label of the source currently being LOADED (from the server's `display_root`),
 * or null when no load is in flight. Drives the "(pending)" document title while
 * streaming; useDocumentTitle prefers it over MANIFEST so a source switch shows
 * the new project name immediately, before its manifest lands. Cleared when the
 * stream settles (success or failure).
 */
export const PENDING_SOURCE_LABEL = signal<string | null>(null);

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

// ── Recently-opened sources (persisted) ──────────────────────────────

export interface RecentSource {
  src: string; // exactly what was typed / passed; goes into ?src=
  branch?: string; // only meaningful for git URLs
  /** True when `branch` was filled in from the manifest's resolved
   *  HEAD (i.e. the user didn't type a branch — we recorded the
   *  repo's default). The picker annotates these rows with "(default)"
   *  so the user knows the branch was inferred, not chosen. */
  branchIsDefault?: boolean;
  label: string; // derived at save time: basename(src) or "owner/repo"
  lastOpenedAt: number; // ms since epoch, for MRU sort
}

/** Persisted list of recently-opened sources. Hydrates at module load. */
export const RECENTS = persistedSignal<RecentSource[]>(PERSISTED_KEYS.RECENTS, []);

export function listRecents(): RecentSource[] {
  return RECENTS.value;
}

/**
 * Push (or update) an entry. Dedupes by (src, branch ?? ''). The pushed
 * entry becomes the most-recent. List is capped at MAX_RECENT_SOURCES
 * entries (oldest dropped).
 *
 * Special case for `branchIsDefault`: when an entry's branch was filled
 * in from the manifest's resolved HEAD (the user didn't type one), we
 * also drop any pre-existing entry for the same src with NO branch
 * recorded. Those are the same logical project — the empty-branch row
 * was just from before we resolved the default — and keeping both
 * leaves a confusing duplicate in the picker.
 */
export function pushRecent(entry: Omit<RecentSource, 'lastOpenedAt'>): void {
  const now = Date.now();
  const filtered = RECENTS.value.filter((r) => {
    if (r.src !== entry.src) return true;
    if ((r.branch ?? '') === (entry.branch ?? '')) return false;
    if (entry.branchIsDefault && !r.branch) return false;
    return true;
  });
  filtered.unshift({ ...entry, lastOpenedAt: now });
  RECENTS.value = filtered.slice(0, MAX_RECENT_SOURCES);
}

/** Drop the entry matching (src, branch). No-op if not present. */
export function removeRecent(src: string, branch?: string): void {
  RECENTS.value = RECENTS.value.filter(
    (r) => !(r.src === src && (r.branch ?? '') === (branch ?? ''))
  );
}
