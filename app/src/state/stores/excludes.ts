// state/stores/excludes.ts — Per-repo UI excludes: rel-paths the user hides from
// the rendered city. Persisted client-side (like recents) so remote URLs work
// without a .codecityignore on disk. Repo-scoped (keyed by src, branch ignored)
// so an exclude holds across branches. These are PREFERENCES only: the backend
// re-derives the filtered manifest from them (see useManifestSource), so there
// is no client-side manifest filtering here.

import { computed, type ReadonlySignal } from '@preact/signals';
import { persistedSignal } from '@/state/persist';
import { PERSISTED_KEYS } from '@/constants/storage';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { sourceKey } from '@/utils/sources';

/** repo key -> sorted, de-duped rel-paths. One localStorage slot for all repos.
 *  Whole-object persistence: keys are runtime repo hashes, not in the default,
 *  so diff-vs-default mode would drop every write. */
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

function setForCurrentRepo(next: string[]): void {
  const cur = CURRENT_SOURCE.peek();
  if (!cur) return; // no source loaded: nothing to key against
  const key = repoKeyFor(cur.src);
  const sorted = [...new Set(next)].sort();
  const map = { ...EXCLUDES.peek() };
  if (sorted.length === 0) delete map[key];
  else map[key] = sorted;
  EXCLUDES.value = map;
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
