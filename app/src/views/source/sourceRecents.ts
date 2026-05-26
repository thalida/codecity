// sourceRecents.ts — Tiny localStorage-backed list of recently-opened
// sources. Used by the source picker modal to show one-click reload rows.

const KEY = 'codecity:recents';
const MAX = 10;

export interface RecentSource {
  src: string; // exactly what was typed / passed; goes into ?src=
  branch?: string; // only meaningful for git URLs
  gitWindow?: string; // per-source git-log --since override (e.g. "1.years.ago");
  // undefined = server default. Only set for git sources
  // where the user picked a non-default in the modal.
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
 */
export function pushRecent(entry: Omit<RecentSource, 'lastOpenedAt'>): void {
  const now = Date.now();
  const list = _read();
  const filtered = list.filter(
    (r) => !(r.src === entry.src && (r.branch ?? '') === (entry.branch ?? ''))
  );
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
