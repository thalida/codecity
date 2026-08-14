// hooks/useSwitcherShowcase.ts — turns the live city into a backdrop while the
// project switcher is open over it: snapshot camera pose, selection and pane
// state, hero-shot the camera, and put it all back on dismiss. Gated on the
// source key, since a switch means the snapshot describes a city that is gone.

import { useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import {
  SWITCHER_SHOWCASE,
  SELECTION_PANE_DISMISSED,
  dismissSelectionPane,
  openSelectionPane,
} from '@/state/stores/ui';
import {
  TIMELINE_MODE,
  TIMELINE_BUNDLE,
  SCRUB_POS,
  enterTimelineMode,
  resetTimelineMode,
} from '@/state/stores/timeline';
import { reapplyTimelineScene } from '@/hooks/useTimelineMode';
import type { TimelineBundle } from '@/types';
import { SCENE_HANDLE, type SceneHandle } from '@/state/stores/scene';
import { CURRENT_SOURCE_KEY } from '@/state/stores/source';
import { NodeKind, type PickerSelectionKey } from '@/types';
import type { CameraPose } from '@/city/render/cameraRig';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Put the selection back, and with it whether its details were showing: a pane
 *  minimised to its chip must not reopen just from being restored. */
function restoreSelection(
  handle: SceneHandle,
  key: PickerSelectionKey | null,
  dismissed: boolean
): void {
  if (!key) return;
  if (key.kind === NodeKind.Commit) handle.picker.selectByCommit(key.sha);
  else handle.picker.selectByPath(key.path);
  if (dismissed) dismissSelectionPane();
  else openSelectionPane();
}

export function useSwitcherShowcase(): void {
  useEffect(() => {
    let active = false;
    let savedPose: CameraPose | null = null;
    let savedSelKey: PickerSelectionKey | null = null;
    let savedSelDismissed = false;
    let savedSourceKey: string | null = null;
    // The backdrop is always plain live, so Timeline is parked on open and put
    // back on dismiss.
    let savedTimeline: { bundle: TimelineBundle; scrubPos: number } | null = null;

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
        savedSelDismissed = SELECTION_PANE_DISMISSED.peek();
        const bundle = TIMELINE_BUNDLE.peek();
        if (TIMELINE_MODE.peek() && bundle) {
          savedTimeline = { bundle, scrubPos: SCRUB_POS.peek() };
          resetTimelineMode(); // the city layer reacts by rebuilding live
        }
        handle.picker.clearSelection();
        handle.rig.enterShowcase({ autoRotate: !prefersReducedMotion() });
      } else if (!showcase && active) {
        active = false;
        if (handle) {
          handle.rig.exitShowcase();
          // Same city → restore verbatim. Switched → the new city owns its
          // framing (and App already cleared the selection on commit).
          if (CURRENT_SOURCE_KEY.peek() === savedSourceKey) {
            if (savedPose) handle.rig.applyPose(savedPose);
            restoreSelection(handle, savedSelKey, savedSelDismissed);
            if (savedTimeline) {
              // Re-pack from the saved bundle rather than refetching it, and only
              // enter once it is packed. A switcher reopened meanwhile owns the mode.
              const { bundle, scrubPos } = savedTimeline;
              TIMELINE_BUNDLE.value = bundle;
              void reapplyTimelineScene().then(() => {
                if (!active) enterTimelineMode(scrubPos);
              });
            }
          }
        }
        savedPose = null;
        savedSelKey = null;
        savedSelDismissed = false;
        savedSourceKey = null;
        savedTimeline = null;
      }
    });

    return () => {
      stop();
      // Safety net if App unmounts mid-showcase (HMR / teardown).
      SCENE_HANDLE.peek()?.rig.exitShowcase();
    };
  }, []);
}
