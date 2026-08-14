// city/layout/worker.ts — Web Worker entry point. Receives a manifest
// + a snapshot of the four config stores layoutCity reads, populates
// the worker's local store instances, runs the layout, posts the
// result back. Pure compute, no DOM or THREE.* references.

import { layoutCity } from './algorithm';
import { createPackReporter } from './packProgress';
import { STREET_LAYOUT, STREET_TIERS } from '@/state/stores/settings/streets';
import { BUILDING_DIMENSIONS } from '@/state/stores/settings/buildings';
import { GEM_SIZING } from '@/state/stores/settings/gem';
import type { LayoutRequest, LayoutResponse } from './protocol';

function _applySnapshot(snap: LayoutRequest['configSnapshot']): void {
  STREET_LAYOUT.value = { ...STREET_LAYOUT.value, ...snap.streetLayout };
  BUILDING_DIMENSIONS.value = { ...BUILDING_DIMENSIONS.value, ...snap.buildingDimensions };
  GEM_SIZING.value = { ...GEM_SIZING.value, ...snap.gemSizing };
  STREET_TIERS.value = { TIERS: snap.streetTiers };
}

self.addEventListener('message', (event: MessageEvent<LayoutRequest>) => {
  const data = event.data;
  if (!data || data.type !== 'layout') return;
  try {
    _applySnapshot(data.configSnapshot);
    // The scanner already counted the tree, so the denominator is free. The
    // main thread is idle awaiting this reply, so each tick repaints at once.
    const onPlaced = createPackReporter(data.manifest.tree.descendants_count, (percent) => {
      const tick: LayoutResponse = { type: 'layout-progress', id: data.id, percent };
      (self as unknown as Worker).postMessage(tick);
    });
    const layout = layoutCity(
      data.manifest as unknown as Parameters<typeof layoutCity>[0],
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
