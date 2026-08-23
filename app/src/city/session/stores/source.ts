// state/stores/source.ts — which repo ONE city is showing: what it opened, how
// it failed, what the chrome prints about it, and the folders hidden inside it.
// The lists that outlive it are recents.ts and excludes.ts.

import { signal, computed, type ReadonlySignal } from '@preact/signals';
import {
  srcKind,
  SourceKind,
  resolveBranch,
  identityBranch,
  sourceKey,
  sameSourceIdentity,
} from '@/utils/sources';
import { EXCLUDES, repoKeyFor, setExcludesFor } from './excludes';
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
  /** The applied source, or null when none is. Written only by set(), so it
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

  /** Show this source: what this city holds, and the manifest the chrome reads.
   *  Every mode ends its load here. Remembering that you opened it is the
   *  app's (see stores/recents), which is why a backdrop can call this too. */
  set = (src: string, branch: string | undefined, loaded: Manifest): SourceRef => {
    // A local source carries no branch: its checkout is dynamic, so identity
    // omits it. The header still shows it, read off the manifest.
    const ref = { src, branch: identityBranch(src, resolveBranch(loaded, branch)) };
    // Source before manifest: the camera-reframe reaction reads the source at
    // apply-start, and the apply is kicked off by the manifest write.
    this.current.value = ref;
    this.manifest.set(loaded);
    return ref;
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
