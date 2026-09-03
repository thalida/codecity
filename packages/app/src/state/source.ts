// state/source.ts — which project is open: its identity, the error that
// stopped it opening, and the one commit point every view goes through.
// Cross-feature, which is why it is here: the landing opens one, the city
// view reads what opened.

import {
  type Manifest,
  srcKind,
  SourceKind,
  resolveBranch,
  identityBranch,
  sourceKey,
  type ScanErrorCode,
} from '@codecity/city';
import { signal, computed } from '@preact/signals';
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

/** A working tree on disk rather than a clone. Only a working tree can change
 *  under the app, so anything watching for change keys off this. */
export const CURRENT_SOURCE_IS_LOCAL = computed<boolean>(() => {
  const cur = CURRENT_SOURCE.value;
  return cur ? srcKind(cur.src) === SourceKind.Local : false;
});

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
