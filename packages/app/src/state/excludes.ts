// state/excludes.ts — the folders you have hidden, per repo. Persisted here
// rather than in settings/ because they ride in the manifest URL beside src and
// branch: they change what the scan RETURNS, not how it is drawn.

import { computed, type ReadonlySignal } from '@preact/signals';
import { sourceKey } from '@codecity/city';
import { persistedSignal } from '@/state/persist';
import { PERSISTED_KEYS } from '@/constants/storage';
import { CURRENT_SOURCE } from '@/state/source';

// ── Folders you have hidden, per repo ─────────────────────────────────

/** repo key -> sorted, de-duped rel-paths. Whole-object persistence: the keys
 *  are runtime repo hashes, so diff-vs-default would drop every write. */
export const EXCLUDES = persistedSignal<Record<string, string[]>>(
  PERSISTED_KEYS.EXCLUDES,
  {},
  { whole: true }
);

/** Repo-scoped key: src only (branch ignored) so excludes hold across branches. */
function repoKeyFor(src: string): string {
  return sourceKey(src);
}

function currentRepoKey(): string | null {
  const cur = CURRENT_SOURCE.value;
  return cur ? repoKeyFor(cur.src) : null;
}

/** The loaded repo's exclude list (empty when no source / none set). Reactive. */
export const ACTIVE_EXCLUDES: ReadonlySignal<string[]> = computed(() => {
  const key = currentRepoKey();
  return key ? (EXCLUDES.value[key] ?? []) : [];
});

/** Peek the excludes for an explicit src — for the imperative fetch layer. */
export function activeExcludePathsFor(src: string): string[] {
  return EXCLUDES.peek()[repoKeyFor(src)] ?? [];
}

/** Replace one repo's exclude list. Sorted and de-duped, and an empty list
 *  drops the slot so the store holds only repos that hide something. */
export function setExcludesFor(src: string, next: readonly string[]): void {
  const key = repoKeyFor(src);
  const sorted = [...new Set(next)].sort();
  const map = { ...EXCLUDES.peek() };
  if (sorted.length === 0) delete map[key];
  else map[key] = sorted;
  EXCLUDES.value = map;
}

function setForCurrentRepo(next: string[]): void {
  const cur = CURRENT_SOURCE.peek();
  if (!cur) return; // no source loaded: nothing to key against
  setExcludesFor(cur.src, next);
}

/** Hide `path` from the current repo's city. Sorted + de-duped. No-op if none. */
export function addExclude(path: string): void {
  setForCurrentRepo([...(EXCLUDES.peek()[currentRepoKey() ?? ''] ?? []), path]);
}

/** Restore `path` (remove from the current repo's excludes). */
export function removeExclude(path: string): void {
  setForCurrentRepo((EXCLUDES.peek()[currentRepoKey() ?? ''] ?? []).filter((p) => p !== path));
}

/** Restore everything for the current repo. */
export function clearExcludes(): void {
  setForCurrentRepo([]);
}
