// hooks/useSwitcherShowcase.ts — turns the live city into a backdrop while the
// project switcher is open over it. On open: snapshot the user's camera pose +
// selection, clear the selection, hide the chrome, and drive the camera into a
// slow auto-rotating hero shot. On dismiss: restore all of it verbatim.
//
// The restore is gated on the source key: if the user actually SWITCHED
// projects (a new city committed), the old pose + selection belong to the gone
// city, so we bow out and let the new city's own framing stand.

import { useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { SWITCHER_SHOWCASE } from '@/state/stores/ui';
import { SCENE_HANDLE, type SceneHandle } from '@/state/stores/scene';
import { CURRENT_SOURCE_KEY } from '@/state/stores/source';
import { NodeKind, type PickerSelectionKey } from '@/types';
import type { CameraPose } from '@/city/render/cameraRig';

const SHOWCASE_CLASS = 'cc-showcase';

function setChromeHidden(hidden: boolean): void {
  document.getElementById('app')?.classList.toggle(SHOWCASE_CLASS, hidden);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function restoreSelection(handle: SceneHandle, key: PickerSelectionKey | null): void {
  if (!key) return;
  if (key.kind === NodeKind.Commit) handle.picker.selectByCommit(key.sha);
  else handle.picker.selectByPath(key.path);
}

export function useSwitcherShowcase(): void {
  useEffect(() => {
    let active = false;
    let savedPose: CameraPose | null = null;
    let savedSelKey: PickerSelectionKey | null = null;
    let savedSourceKey: string | null = null;

    // peek the handle (untracked): showcase only turns true over a loaded city,
    // so the handle is present — no need to re-run when it changes.
    const stop = effect(() => {
      const showcase = SWITCHER_SHOWCASE.value;
      const handle = SCENE_HANDLE.peek();

      if (showcase && !active) {
        if (!handle) return; // no scene to drive (shouldn't happen over a city)
        active = true;
        savedSourceKey = CURRENT_SOURCE_KEY.peek();
        savedPose = handle.rig.getPose();
        savedSelKey = handle.picker.selectionKey.peek();
        handle.picker.clearSelection();
        setChromeHidden(true);
        handle.rig.enterShowcase({ autoRotate: !prefersReducedMotion() });
      } else if (!showcase && active) {
        active = false;
        setChromeHidden(false);
        if (handle) {
          handle.rig.exitShowcase();
          // Same city → restore verbatim. Switched → the new city owns its
          // framing (and App already cleared the selection on commit).
          if (CURRENT_SOURCE_KEY.peek() === savedSourceKey) {
            if (savedPose) handle.rig.applyPose(savedPose);
            restoreSelection(handle, savedSelKey);
          }
        }
        savedPose = null;
        savedSelKey = null;
        savedSourceKey = null;
      }
    });

    return () => {
      stop();
      // Safety net if App unmounts mid-showcase (HMR / teardown).
      setChromeHidden(false);
      SCENE_HANDLE.peek()?.rig.exitShowcase();
    };
  }, []);
}
