// city/City.tsx — the <canvas> and its Three.js lifecycle: this folder's mount
// point, beside the createCity API it drives. Mount applies MANIFEST on every
// change, unmount tears the scene down so a remount cannot stack a second
// renderer on it, and the variant is all a view says about what it is FOR.

import './City.css';
import { useRef, useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { createCity } from '@/city';
import { CameraMode } from '@/city/render/cameraRig';
import { attachSettingsReactions } from '@/state/settings/reactions';
import { BACKDROP_HANDLE, SCENE_HANDLE } from '@/city/sceneHandle';
import { MANIFEST } from '@/state/stores/manifest';
import { markRebuilding, markError } from '@/state/stores/progress';
import { TIMELINE_MODE } from '@/state/stores/timeline';
import { reapplyTimelineScene } from '@/hooks/useTimelineMode';
import type { Manifest } from '@/types';

export enum CityVariant {
  /** The app's main view: opaque, so a sub-frame gap during resize blends into
   *  the page instead of flashing through. */
  Scene = 'scene',
  /** Wallpaper: transparent, so whatever the view puts behind it (the hero
   *  image) shows until the city has something to paint. */
  Backdrop = 'backdrop',
}

export interface CityProps {
  variant?: CityVariant;
}

export function City({ variant = CityVariant.Scene }: CityProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let city: Awaited<ReturnType<typeof createCity>> | null = null;
    let unsubApply: (() => void) | null = null;
    let disposeReactions: (() => void) | null = null;

    // Start empty; the apply-effect below paints the first manifest. The variant
    // is also what the camera is FOR, so the rig opens on the right pose itself.
    createCity(canvas, {
      cameraMode: variant === CityVariant.Backdrop ? CameraMode.Backdrop : CameraMode.Project,
    })
      .then((handle) => {
        // Unmounted before the async build resolved: dispose the orphan now, or
        // its renderer + frame loop leak forever (nothing else holds a ref).
        if (disposed) {
          handle.dispose();
          return;
        }
        city = handle;
        // Published to its own slot: the two variants are independent cities.
        if (variant === CityVariant.Scene) SCENE_HANDLE.value = handle;
        else BACKDROP_HANDLE.value = handle;
        disposeReactions = attachSettingsReactions({
          // Rebuild the current mode (Timeline: union + scrub; Live: HEAD).
          rebuildScene: () =>
            TIMELINE_MODE.peek()
              ? reapplyTimelineScene()
              : handle.applyManifest(MANIFEST.peek() as Manifest),
          invalidateLayoutCache: handle.invalidateLayoutCache,
        });

        // A backdrop shows what its view decided to show, which is not the
        // opened project: useHomeBackdrop drives that canvas itself.
        if (variant !== CityVariant.Scene) return;

        // Only kicks off the apply and surfaces its error: reaching Idle belongs
        // to the decoration pass, and reframing to the city composer.
        unsubApply = effect(() => {
          const m = MANIFEST.value as Manifest;
          if (!m) return; // nothing to build yet
          // Live's bridge from manifest to scene; Timeline packs its own union
          // city. Peeked, so leaving the mode doesn't repack what it committed.
          if (TIMELINE_MODE.peek()) return;
          markRebuilding();
          void handle.applyManifest(m).catch(markError);
        });
      })
      .catch((err) => {
        // No WebGL, or a context the driver refused. The landing has its
        // wallpaper to fall back on; the city route has nothing to show.
        if (variant === CityVariant.Scene) markError(err);
      });

    return () => {
      disposed = true;
      unsubApply?.();
      disposeReactions?.();
      // Tear the city down so a remount doesn't stack a second renderer +
      // frame loop on the same canvas (old city keeps rendering as a ghost).
      city?.dispose();
      city = null;
      // Only its own slot: clearing the other would strand the city still up.
      if (variant === CityVariant.Scene) SCENE_HANDLE.value = null;
      else BACKDROP_HANDLE.value = null;
    };
  }, []);

  // Non-text content needs a text alternative (WCAG 1.1.1). Keyboard users
  // browse the same data through Explore and Search.
  return (
    <canvas
      id="city"
      class={`city-canvas city-canvas--${variant}`}
      ref={canvasRef}
      role="img"
      aria-label="3D city map of the repository. Files are buildings, directories are streets, commits are trees. Browse it with the file tree and search panels."
    />
  );
}
