// views/shell/CenterPane.tsx — Pure JSX wrapper around the city canvas.
// Scene init (startRenderLoop, world/picker/rig construction) lives in
// runtime/boot.ts, which finds this canvas via getElementById('city')
// after Preact has committed the render. Keeping the component thin
// avoids the double-mount risk that existed when both CenterPane and
// boot.ts called startRenderLoop themselves.

export function CenterPane() {
  return (
    <div id="center-pane">
      <canvas id="city" />
    </div>
  );
}
