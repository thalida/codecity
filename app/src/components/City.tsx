// layout/City.tsx — the city <canvas> and its Three.js lifecycle. Mount builds
// the scene and applies MANIFEST on every change; unmount tears it down so a
// remount can't stack a second renderer and frame loop on the canvas.

import { useRef, useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { createCity } from '@/city';
import { attachSettingsReactions } from '@/state/settingsReactions';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { MANIFEST, markRebuilding, markError } from '@/state/stores/manifest';
import { TIMELINE_MODE } from '@/state/stores/timeline';
import { reapplyTimelineScene } from '@/hooks/useTimelineMode';
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
        // Rebuild the current mode (Timeline: union + scrub; Live: HEAD).
        rebuildScene: () =>
          TIMELINE_MODE.peek()
            ? reapplyTimelineScene()
            : handle.applyManifest(MANIFEST.peek() as Manifest),
        invalidateLayoutCache: handle.invalidateLayoutCache,
      });

      // Only kicks off the apply and surfaces its error: reaching Idle belongs
      // to the decoration pass, and reframing to the city composer.
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

  // Non-text content needs a text alternative (WCAG 1.1.1). Keyboard users
  // browse the same data through Explore and Search.
  return (
    <canvas
      id="city"
      ref={canvasRef}
      role="img"
      aria-label="3D city map of the repository. Files are buildings, directories are streets, commits are trees. Browse it with the file tree and search panels."
    />
  );
}
