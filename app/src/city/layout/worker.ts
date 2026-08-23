// city/layout/worker.ts — Web Worker entry point. Receives a manifest and the
// city's own layout config, runs the layout, posts the result back. Pure
// compute, no DOM or THREE.* references.

import { layoutCity } from './algorithm';
import { createPackReporter } from './packProgress';
import type { LayoutRequest, LayoutResponse } from './protocol';

self.addEventListener('message', (event: MessageEvent<LayoutRequest>) => {
  const data = event.data;
  if (!data || data.type !== 'layout') return;
  try {
    // The scanner already counted the tree, so the denominator is free. The
    // main thread is idle awaiting this reply, so each tick repaints at once.
    const onPlaced = createPackReporter(data.manifest.tree.descendants_count, (percent) => {
      const tick: LayoutResponse = { type: 'layout-progress', id: data.id, percent };
      (self as unknown as Worker).postMessage(tick);
    });
    const layout = layoutCity(
      data.manifest as unknown as Parameters<typeof layoutCity>[0],
      data.configSnapshot,
      onPlaced
    );
    const reply: LayoutResponse = {
      type: 'layout-result',
      id: data.id,
      layout,
    };
    (self as unknown as Worker).postMessage(reply);
  } catch (err) {
    const reply: LayoutResponse = {
      type: 'layout-error',
      id: data.id,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(reply);
  }
});
