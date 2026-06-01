// layout/CenterPane.tsx — Owns the city <canvas> and its scene lifecycle.
// useCity() hands the canvas to the boot + manifest-loading orchestration on
// mount and tears the scene down on unmount. The canvas is reached via a ref
// (not getElementById), so the scene is tied to this component's lifecycle
// rather than to DOM-query timing.

import { useRef } from 'preact/hooks';
import { useCity } from '@/hooks/useCity';

export function CenterPane() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useCity(canvasRef);

  return (
    <div id="center-pane">
      <canvas id="city" ref={canvasRef} />
    </div>
  );
}
