// hooks/useCityScene.ts — Render layer. Owns the <canvas> scene lifecycle:
// builds the Three.js scene on mount, wires settings-commit reactions, and
// applies the MANIFEST signal (the fetch layer's source of truth) to the scene
// whenever it changes. Publishes SCENE_HANDLE for views that need picker/rig.

import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
import { effect } from '@preact/signals';
import { startRenderLoop } from '@/scene/renderLoop';
import { attachCommitReactions } from '@/state/settingsReactions';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { LOADING_OVERLAY } from '@/state/stores/ui';
import { MANIFEST, REBUILD_STATUS, RebuildStatus, LAST_REBUILD_ERROR } from '@/state/stores/manifest';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { isEmptyManifest } from '@/utils/manifest';
import type { Manifest } from '@/types';

export function useCityScene(canvasRef: RefObject<HTMLCanvasElement | null>): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let unsubApply: (() => void) | null = null;
    let disposeReactions: (() => void) | null = null;

    // Start the scene empty; the apply-effect below paints the first real
    // manifest as soon as the fetch layer publishes it.
    startRenderLoop(canvas, EMPTY_MANIFEST).then((handle) => {
      if (disposed) return;
      SCENE_HANDLE.value = handle;
      disposeReactions = attachCommitReactions({ world: handle.world, applyTheme: handle.applyTheme });

      // Apply MANIFEST → scene on every change. world.applyManifest owns its own
      // skeleton→final tween + the Decorating→Idle status; this effect owns only
      // the Rebuilding flip + a render-error surface.
      let first = true;
      unsubApply = effect(() => {
        const m = MANIFEST.value as Manifest;
        if (isEmptyManifest(m)) return; // nothing to build yet
        // Show the footer "rebuilding" dot only for changes AFTER the initial
        // load settles — i.e. background live-updates. Two guards together:
        //   • `first`          — the scene's very first real apply (covers the
        //                         fast-fetch / slow-scene boot ordering where the
        //                         overlay is already down when this effect's
        //                         first run fires).
        //   • overlay.visible  — the cold-boot / source-switch skeleton+final
        //                         applies all land while the loading overlay is
        //                         up; the overlay is their UX, so don't also
        //                         flash the dot. peek() so this effect tracks
        //                         only MANIFEST, never the overlay signal.
        if (!first && !LOADING_OVERLAY.peek().visible) {
          REBUILD_STATUS.value = RebuildStatus.Rebuilding;
        }
        first = false;
        void handle.world.applyManifest(m).then(
          () => { LAST_REBUILD_ERROR.value = null; },
          (err) => {
            REBUILD_STATUS.value = RebuildStatus.Error;
            LAST_REBUILD_ERROR.value = err instanceof Error ? err.message : String(err);
          }
        );
      });
    });

    return () => {
      disposed = true;
      unsubApply?.();
      disposeReactions?.();
      SCENE_HANDLE.value = null;
    };
  }, []);
}
