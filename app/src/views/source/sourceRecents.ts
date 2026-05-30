// sourceRecents.ts — Tiny localStorage-backed list of recently-opened
// sources. Used by the source picker modal to show one-click reload rows.

const KEY = 'codecity:recents';
const MAX = 10;

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

function _read(): RecentSource[] {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as RecentSource[]) : [];
  } catch {
    return [];
  }
}

function _write(list: RecentSource[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function listRecents(): RecentSource[] {
  return _read();
}

/**
 * Push (or update) an entry. Dedupes by (src, branch ?? ''). The pushed
 * entry becomes the most-recent. List is capped at MAX entries (oldest
 * dropped).
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
  const list = _read();
  const filtered = list.filter((r) => {
    if (r.src !== entry.src) return true;
    if ((r.branch ?? '') === (entry.branch ?? '')) return false;
    if (entry.branchIsDefault && !r.branch) return false;
    return true;
  });
  filtered.unshift({ ...entry, lastOpenedAt: now });
  _write(filtered.slice(0, MAX));
}

/**
 * Drop the entry matching (src, branch). No-op if not present.
 */
export function removeRecent(src: string, branch?: string): void {
  const list = _read();
  const filtered = list.filter((r) => !(r.src === src && (r.branch ?? '') === (branch ?? '')));
  _write(filtered);
}
