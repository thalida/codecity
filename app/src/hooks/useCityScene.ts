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
import { MANIFEST, REBUILD_STATUS, RebuildStatus, LAST_REBUILD_ERROR } from '@/state/stores/manifest';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { isEmptyManifest } from '@/utils/manifest';
import { CURRENT_SOURCE_KEY } from '@/state/stores/source';
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
      // skeleton→final tween + the Decorating→Idle status; this effect flips the
      // footer to Rebuilding before each apply (it always clears back to Idle
      // when applyManifest finishes — including the trees-off path) and surfaces
      // a render-apply error. During cold-boot / source-switch loads the loading
      // overlay is also up; the brief Rebuilding state is truthful (the world is
      // being built) and clears as soon as the apply completes.
      let lastSourceKey: string | null = null;
      unsubApply = effect(() => {
        const m = MANIFEST.value as Manifest;
        if (isEmptyManifest(m)) return; // nothing to build yet
        REBUILD_STATUS.value = RebuildStatus.Rebuilding;
        // Capture the applied source at apply-START. The fetch layer commits
        // CURRENT_SOURCE between the skeleton and the FINAL manifest, so a changed
        // key here marks the final apply of a (re)load — the one moment to frame
        // the new city. The preceding skeleton apply still sees the old/empty key
        // → no reframe; live-updates / settings rebuilds keep the same key → none.
        const cur = CURRENT_SOURCE_KEY.peek();
        const shouldReframe = cur !== null && cur !== lastSourceKey;
        void handle.world.applyManifest(m).then(
          () => {
            LAST_REBUILD_ERROR.value = null;
            if (shouldReframe) {
              // Explicit, traceable camera reframe (view layer owns this). The new
              // world is built, so resetView snaps to its freshly-captured default
              // pose (cameraRig._captureFraming ran during this apply).
              handle.resetView();
              lastSourceKey = cur;
            }
          },
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
