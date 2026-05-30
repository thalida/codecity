// views/shell/CenterPane.tsx — Mounts the Three.js scene into a canvas
// element. On mount it calls startRenderLoop to build the city, stores
// the returned handle in the SCENE_HANDLE signal, and clears it on
// unmount. Other components read SCENE_HANDLE.value to access world /
// picker / rig.

import { useEffect, useRef } from 'preact/hooks';
import { startRenderLoop } from '../../scene/renderLoop';
import { SCENE_HANDLE } from '../../state/runtime/scene';
import type { Manifest } from '../../types';

interface CenterPaneProps {
  initialManifest: Manifest;
}

export function CenterPane({ initialManifest }: CenterPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let disposed = false;
    let handle: Awaited<ReturnType<typeof startRenderLoop>> | null = null;
    (async () => {
      if (!canvasRef.current || disposed) return;
      handle = await startRenderLoop(canvasRef.current, initialManifest);
      if (disposed) {
        // Race: unmount fired before async setup finished. The handle
        // was already created by startRenderLoop — nothing to dispose
        // since the render loop doesn't expose a stop() yet. Clear the
        // signal so downstream consumers know the scene is gone.
        handle = null;
        return;
      }
      SCENE_HANDLE.value = handle;
    })();
    return () => {
      disposed = true;
      SCENE_HANDLE.value = null;
    };
  }, []);

  return (
    <div id="center-pane">
      <canvas id="city" ref={canvasRef}></canvas>
    </div>
  );
}
