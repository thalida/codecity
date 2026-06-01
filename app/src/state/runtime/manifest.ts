// state/runtime/manifest.ts — Canonical signal mirroring the scene's current
// manifest. The scene (world.getManifest()) is the source of truth; this
// signal tracks SCENE_HANDLE + world.onChange so view code (tree / search /
// info panes, and anything else) can read the manifest reactively without
// reaching into the scene handle. Defined at module scope so it survives
// remounts; the bridge installs once at module load.

import { signal, effect } from '@preact/signals';
import type { Manifest, DirNode } from '@/types';
import { SCENE_HANDLE } from './scene';
import { LAST_UPDATED_AT } from './manifestPoll';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { isEmptyManifest } from '@/utils/manifest';

export const MANIFEST = signal<Manifest | DirNode | { tree?: unknown; [k: string]: unknown } | null>(
  EMPTY_MANIFEST
);

let _installed = false;
function _installBridge(): void {
  if (_installed) return;
  _installed = true;
  let _worldUnsub: (() => void) | null = null;
  // effect() tracks SCENE_HANDLE (a signal); world.onChange is a custom
  // emitter, not a signal, so it stays an explicit subscription.
  effect(() => {
    const handle = SCENE_HANDLE.value;
    if (_worldUnsub) {
      _worldUnsub();
      _worldUnsub = null;
    }
    if (!handle) {
      MANIFEST.value = EMPTY_MANIFEST;
      return;
    }
    MANIFEST.value = handle.world.getManifest() ?? EMPTY_MANIFEST;
    _worldUnsub = handle.world.onChange(() => {
      MANIFEST.value = handle.world.getManifest() ?? EMPTY_MANIFEST;
    });
  });
}
_installBridge();

// Record when a (non-empty) manifest is applied — drives the footer's
// "last updated" readout. Previously bumped imperatively in boot's
// world.onChange handler; now derived from the canonical MANIFEST signal.
effect(() => {
  if (!isEmptyManifest(MANIFEST.value)) {
    LAST_UPDATED_AT.value = Date.now();
  }
});
