// state/source.ts — which project is open: its identity, the error that
// stopped it opening, and the one commit point every view goes through.
// Cross-feature, which is why it is here: the landing opens one, the city
// view reads what opened.

import type { Manifest } from '@codecity/city';
import { signal, computed } from '@preact/signals';
import { srcKind, SourceKind, resolveBranch, identityBranch, sourceKey } from '@codecity/city';
import type { ScanErrorCode } from '@codecity/city';
import { pushRecent } from '@/state/recents';

/** What the switcher hands over when you open something. */
export interface SourcePayload {
  src: string;
  branch?: string;
  /** Ask the server to re-scan rather than answer from its cache. */
  skipCache?: boolean;
}

/** Why a source could not be opened, and what to put back in the form. */
export interface SourceError {
  error: string;
  /** The failure's machine-readable reason, where the server gave one, so the
   *  form can offer a remedy instead of only echoing the message. */
  code?: ScanErrorCode;
  prefill?: SourcePayload;
}

// ── Currently-loaded source ──────────────────────────────────────────

/** The applied source, or null when none is (cold boot / picker open). Written
 *  only by commitSource below, so it means "a load succeeded". */
export const CURRENT_SOURCE = signal<{ src: string; branch?: string } | null>(null);

/** The last load failure, or null. A fetch outcome, not a UI command: App
 *  reacts by opening the picker, and clears it when the user acts. */
export const SOURCE_ERROR = signal<SourceError | null>(null);

/** The loaded source's stable hash, or null. Namespaces per-source storage. */
export const CURRENT_SOURCE_KEY = computed<string | null>(() =>
  CURRENT_SOURCE.value ? sourceKey(CURRENT_SOURCE.value.src, CURRENT_SOURCE.value.branch) : null
);

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

/** A working tree on disk rather than a clone. Only a working tree can change
 *  under the app, so anything watching for change keys off this. */
export const CURRENT_SOURCE_IS_LOCAL = computed<boolean>(() => {
  const cur = CURRENT_SOURCE.value;
  return cur ? srcKind(cur.src) === SourceKind.Local : false;
});

/** What is on screen, named: the label the server gave it, the branch it
 *  resolved to, and where it came from. Derived from the city's own manifest */
export function sourceInfoFrom(manifest: Manifest | null): SourceInfo {
  const cur = CURRENT_SOURCE.value;
  if (!cur || !manifest) {
    return { label: '', branch: undefined, sourceUrl: undefined, src: undefined };
  }
  return {
    label: manifest.tree?.name ?? '',
    branch: resolveBranch(manifest, cur.branch),
    sourceUrl: srcKind(cur.src) === SourceKind.Remote ? cur.src : undefined,
    src: cur.src,
  };
}

/** Commit a loaded source: CURRENT_SOURCE, its recents entry, and the manifest
 *  the UI reads. Every mode ends its load here, with its own manifest. */
export function commitSource(src: string, branch: string | undefined, manifest: Manifest): void {
  // ONE identity for the load, used by both writes below. Deriving it twice is
  // what listed a repo twice (#185): see the test for the two rows it produced.
  const checkout = resolveBranch(manifest, branch);
  // A local source carries no branch: its checkout is dynamic, so identity omits
  // it. The header still shows it, read off the manifest — display, not identity.
  const idBranch = identityBranch(src, checkout);
  // Source before manifest: the camera-reframe reaction reads CURRENT_SOURCE at
  // apply-start, and the apply is kicked off by the manifest write.
  CURRENT_SOURCE.value = { src, branch: idBranch };
  pushRecent({
    src,
    // tree.name is the canonical owner/repo; a worktree's basename is its folder.
    label: manifest.tree?.name || src,
    branch: idBranch,
    checkout,
  });
}
