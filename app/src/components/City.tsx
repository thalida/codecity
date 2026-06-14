// layout/City.tsx — the city <canvas> and its Three.js scene lifecycle as a
// self-contained component. On mount it builds the scene (createCity), wires
// settings-commit reactions, and applies the MANIFEST signal (the fetch layer's
// source of truth) to the scene on every change; on unmount it tears the city
// down so a remount can't stack a second renderer + frame loop on the canvas.
// Publishes SCENE_HANDLE for views that need picker/rig. The canvas is reached
// via a ref (not getElementById), so the scene is tied to this component's
// lifecycle rather than to DOM-query timing.

import { useRef, useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { createCity } from '@/city';
import { attachSettingsReactions } from '@/state/settingsReactions';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { MANIFEST, markRebuilding, markError } from '@/state/stores/manifest';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { isEmptyManifest } from '@/utils/manifest';
import type { Manifest } from '@/types';

export function City() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let city: Awaited<ReturnType<typeof createCity>> | null = null;
    let unsubApply: (() => void) | null = null;
    let disposeReactions: (() => void) | null = null;

    // Start the scene empty; the apply-effect below paints the first real
    // manifest as soon as the fetch layer publishes it.
    createCity(canvas, EMPTY_MANIFEST).then((handle) => {
      // Unmounted before the async build resolved: dispose the orphan now, or
      // its renderer + frame loop leak forever (nothing else holds a ref).
      if (disposed) {
        handle.dispose();
        return;
      }
      city = handle;
      SCENE_HANDLE.value = handle;
      disposeReactions = attachSettingsReactions({
        applyManifest: handle.applyManifest,
        invalidateLayoutCache: handle.invalidateLayoutCache,
      });

      // Apply MANIFEST → scene on every change. This flips the footer to
      // Rebuilding before each apply; success → Idle (+ error clear) is owned by
      // the trees decoration pass (markIdle, the last stage of every
      // applyManifest), and the camera reframe-on-source-change lives in the city
      // composer — so this effect only kicks off the apply and surfaces a
      // render-apply error.
      unsubApply = effect(() => {
        const m = MANIFEST.value as Manifest;
        if (isEmptyManifest(m)) return; // nothing to build yet
        markRebuilding();
        void handle.applyManifest(m).catch(markError);
      });
    });

    return () => {
      disposed = true;
      unsubApply?.();
      disposeReactions?.();
      // Tear the city down so a remount doesn't stack a second renderer +
      // frame loop on the same canvas (old city keeps rendering as a ghost).
      city?.dispose();
      city = null;
      SCENE_HANDLE.value = null;
    };
  }, []);

  return <canvas id="city" ref={canvasRef} />;
}
