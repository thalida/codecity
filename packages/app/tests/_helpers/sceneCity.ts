// A scene city for a test that drives the app's load orchestration. The real
// source loader over the real client, so the stream still runs through
// EventSource and every assertion about phases and cancellation still means
// something; only the rendering is stubbed, which jsdom has no GPU for anyway.

import { createClient } from '@/city/client';
import { createEmitter } from '@/city/events';
import { createSourceLoader } from '@/city/loadSource';
import { SCENE_HANDLE, type SceneHandle } from '@/city/sceneHandle';
import { attachScanProgress } from '@/hooks/useManifestSource';
import type { Manifest } from '@/city/types/manifest';

export interface StubSceneCity {
  /** Every manifest the city was asked to render, in order. */
  applied: Manifest[];
  dispose(): void;
}

/** Publish a scene city the app can load into, wired to the app's scan
 *  reduction exactly as City.tsx wires it. */
export function stubSceneCity(): StubSceneCity {
  const events = createEmitter();
  const client = createClient({ baseUrl: '/api' });
  const applied: Manifest[] = [];
  const loader = createSourceLoader({
    client,
    events,
    applyManifest: async (m) => void applied.push(m),
  });
  const detach = attachScanProgress(events.on);

  SCENE_HANDLE.value = {
    on: events.on,
    client,
    loadSource: loader.load,
    cancelLoad: loader.cancel,
    applyManifest: async (m: Manifest) => void applied.push(m),
    dispose() {},
  } as unknown as SceneHandle;

  return {
    applied,
    dispose(): void {
      detach();
      loader.dispose();
      events.clear();
      SCENE_HANDLE.value = null;
    },
  };
}
