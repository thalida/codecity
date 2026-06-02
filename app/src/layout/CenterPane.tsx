// layout/CenterPane.tsx — Owns the city <canvas> and its scene lifecycle.
// useCityScene() hands the canvas to the render layer on mount: it builds the
// Three.js scene, wires settings-commit reactions, and applies the MANIFEST
// signal to the scene whenever it changes, tearing the scene down on unmount.
// The canvas is reached via a ref (not getElementById), so the scene is tied to
// this component's lifecycle rather than to DOM-query timing.

import { useRef } from 'preact/hooks';
import { useCityScene } from '@/hooks/useCityScene';

export function CenterPane() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useCityScene(canvasRef);

  return (
    <div id="center-pane">
      <canvas id="city" ref={canvasRef} />
    </div>
  );
}
