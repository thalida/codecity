// state/stores/source.ts — which repo. Per project: the one this session
// opened, how it failed, the folders hidden inside it. App-wide: the ones
// opened before, their exclude lists, and the repo behind the landing. The
// excludes live here because the fetch layer sends them in the manifest URL.

import { signal, computed, type ReadonlySignal } from '@preact/signals';
import { persistedSignal } from '@/state/persist';
import { PERSISTED_KEYS } from '@/constants/storage';
import { MAX_RECENT_SOURCES } from '@/constants/ui';
import {
  srcKind,
  SourceKind,
  resolveBranch,
  identityBranch,
  sourceKey,
  sameSourceIdentity,
} from '@/utils/sources';
import type { ManifestStore } from './manifest';
import type { Manifest, SourceError } from '@/types';

// ── One project's source ─────────────────────────────────────────────

export interface SourceRef {
  src: string;
  branch?: string;
}

export interface SourceInfo {
  /** Human-readable project label (owner/repo or directory name). */
  label: string;
  /** Branch name when the loaded source is a git URL with a known branch. */
  branch: string | undefined;
  /** Original git URL when the source is a hosted git repo. */
  sourceUrl: string | undefined;
  /** Raw source as entered: the git URL for a remote, the path for a local. */
  src: string | undefined;
}

export class SourceStore {
  /** The applied source, or null when none is. Written only by commit(), so it
   *  means "a load succeeded". */
  readonly current = signal<SourceRef | null>(null);
  /** The last load failure, or null. A fetch outcome, not a UI command. */
  readonly error = signal<SourceError | null>(null);
  /** Its stable hash, or null. Namespaces per-source storage. */
  readonly key: ReadonlySignal<string | null>;
  /** A working tree on disk rather than a clone: only a working tree changes
   *  under the app, so anything watching for change keys off this. */
  readonly isLocal: ReadonlySignal<boolean>;
  /** Everything the chrome prints about it, off the manifest it loaded. */
  readonly info: ReadonlySignal<SourceInfo>;
  /** The folders hidden in this repo (empty when none / no source). */
  readonly excludes: ReadonlySignal<string[]>;

  constructor(private readonly manifest: ManifestStore) {
    this.key = computed(() =>
      this.current.value ? sourceKey(this.current.value.src, this.current.value.branch) : null
    );

    this.isLocal = computed(() => {
      const cur = this.current.value;
      return cur ? srcKind(cur.src) === SourceKind.Local : false;
    });

    this.info = computed(() => {
      const cur = this.current.value;
      const m = this.manifest.current.value;
      if (!cur || !m) {
        return { label: '', branch: undefined, sourceUrl: undefined, src: undefined };
      }
      const loaded = m as Manifest;
      return {
        label: loaded.tree?.name ?? '',
        branch: resolveBranch(loaded, cur.branch),
        sourceUrl: srcKind(cur.src) === SourceKind.Remote ? cur.src : undefined,
        src: cur.src,
      };
    });

    this.excludes = computed(() => {
      const cur = this.current.value;
      return cur ? (EXCLUDES.value[repoKeyFor(cur.src)] ?? []) : [];
    });
  }

  /** Commit a loaded source: this session's source, its recents entry, and the
   *  manifest the UI reads. Every mode ends its load here. */
  commit = (src: string, branch: string | undefined, loaded: Manifest): void => {
    // ONE identity for the load, used by both writes below. Deriving it twice
    // is what listed a repo twice (#185): see the test for the two rows.
    const checkout = resolveBranch(loaded, branch);
    // A local source carries no branch: its checkout is dynamic, so identity
    // omits it. The header still shows it, read off the manifest.
    const idBranch = identityBranch(src, checkout);
    // Source before manifest: the camera-reframe reaction reads the source at
    // apply-start, and the apply is kicked off by the manifest write.
    this.current.value = { src, branch: idBranch };
    this.manifest.set(loaded);
    pushRecent({
      src,
      // tree.name is the canonical owner/repo; a worktree's is its folder.
      label: loaded.tree?.name || src,
      branch: idBranch,
      checkout,
    });
  };

  /** Whether these name the city this session already has open. */
  isOpen = (src?: string | null, branch?: string | null): boolean => {
    const cur = this.current.peek();
    return !!cur && !!src && sameSourceIdentity(cur, { src, branch: branch ?? undefined });
  };

  /** Hide `path` from this repo's city, restore one, restore all. */
  addExclude = (path: string): void => this.setExcludes([...this.excludes.peek(), path]);
  removeExclude = (path: string): void =>
    this.setExcludes(this.excludes.peek().filter((p) => p !== path));
  clearExcludes = (): void => this.setExcludes([]);

  private setExcludes(next: string[]): void {
    const cur = this.current.peek();
    if (!cur) return; // no source loaded: nothing to key against
    setExcludesFor(cur.src, next);
  }
}

// ── Recently-opened sources (persisted, app-wide) ────────────────────

export interface RecentSource {
  src: string; // exactly what was typed / passed; goes into ?src=
  branch?: string; // identity; identityBranch strips it for a local source
  // Display only. The label comes from the git remote, so every worktree of one
  // repo shares it and this is all that tells those rows apart.
  checkout?: string;
  label: string; // derived at save time: basename(src) or "owner/repo"
  lastOpenedAt: number; // ms since epoch, for MRU sort
}

/** Persisted list of recently-opened sources. Hydrates at module load. */
export const RECENTS = persistedSignal<RecentSource[]>(PERSISTED_KEYS.RECENTS, []);

/** Push (or update) an entry, most-recent first. Dedupes by source identity, so
 *  a local path is one row regardless of checkout. Capped, oldest dropped. */
export function pushRecent(entry: Omit<RecentSource, 'lastOpenedAt'>): void {
  const now = Date.now();
  const filtered = RECENTS.value.filter((r) => !sameSourceIdentity(r, entry));
  filtered.unshift({ ...entry, lastOpenedAt: now });
  RECENTS.value = filtered.slice(0, MAX_RECENT_SOURCES);
}

/** Drop the entry matching the given source identity. No-op if not present. */
export function removeRecent(src: string, branch?: string): void {
  RECENTS.value = RECENTS.value.filter((r) => !sameSourceIdentity(r, { src, branch }));
}

// ── The city behind the landing ───────────────────────────────────────

/** Which repo the backdrop came from. */
export enum BackdropKind {
  /** The most recent project, from whatever the server had cached for it. */
  Recent = 'recent',
  /** The server's featured repo. */
  Featured = 'featured',
}

export interface BackdropCity {
  src: string;
  label: string;
  /** The loaded branch, normalised like a session's: identity includes it, so a
   *  row storing @main only matches when this carries it too. */
  branch?: string;
  kind: BackdropKind;
}

/** Written only once the backdrop has actually painted, so nothing names a repo
 *  you can't see. Null means the hero image is what's showing. */
export const BACKDROP_CITY = signal<BackdropCity | null>(null);

/** What is on screen: the project a session opened, or the repo behind the
 *  landing. Read during render, since it tracks the backdrop. */
export function activeSourceOf(opened: SourceRef | null): SourceRef | null {
  if (opened) return opened;
  const backdrop = BACKDROP_CITY.value;
  return backdrop ? { src: backdrop.src, branch: backdrop.branch } : null;
}

// ── Folders you have hidden, per repo (app-wide, keyed by repo) ───────

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
