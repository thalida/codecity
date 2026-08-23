// state/stores/excludes.ts — the folders you have hidden, keyed by repo rather
// than by session: hiding vendor/ in a repo hides it every time you open it,
// on any branch.

import { persistedSignal } from '@/state/persist';
import { PERSISTED_KEYS } from '@/constants/storage';
import { sourceKey } from '@/utils/sources';

/** repo key -> sorted, de-duped rel-paths. Whole-object persistence: the keys
 *  are runtime repo hashes, so diff-vs-default would drop every write. */
export const EXCLUDES = persistedSignal<Record<string, string[]>>(
  PERSISTED_KEYS.EXCLUDES,
  {},
  { whole: true }
);

/** Repo-scoped key: src only (branch ignored) so excludes hold across branches. */
export function repoKeyFor(src: string): string {
  return sourceKey(src);
}

/** Peek the excludes for an explicit src — for the imperative fetch layer. */
export function activeExcludePathsFor(src: string): string[] {
  return EXCLUDES.peek()[repoKeyFor(src)] ?? [];
}

/** Replace one repo's exclude list. Sorted and de-duped, and an empty list
 *  drops the slot so the store holds only repos that hide something. */
export function setExcludesFor(src: string, next: readonly string[]): void {
  const repo = repoKeyFor(src);
  const sorted = [...new Set(next)].sort();
  const map = { ...EXCLUDES.peek() };
  if (sorted.length === 0) delete map[repo];
  else map[repo] = sorted;
  EXCLUDES.value = map;
}
