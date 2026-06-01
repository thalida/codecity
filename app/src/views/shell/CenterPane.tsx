// views/shell/CenterPane.tsx — Owns the city <canvas> and its scene lifecycle.
// On mount it hands the canvas to bootApp(), which builds the world/picker/rig
// and starts the render loop; the returned dispose() tears the scene down on
// unmount. The canvas is reached via a ref (not getElementById), so the scene
// is tied to this component's lifecycle rather than to DOM-query timing.

import { useEffect, useRef } from 'preact/hooks';
import { bootApp } from '@/state/runtime/boot';

export function CenterPane() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    bootApp(canvas).then((d) => {
      if (cancelled) d();
      else dispose = d;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  return (
    <div id="center-pane">
      <canvas id="city" ref={canvasRef} />
    </div>
  );
}
