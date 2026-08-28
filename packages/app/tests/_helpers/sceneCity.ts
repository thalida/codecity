// A scene city for a test that drives the app's load orchestration. The real
// source loader over the real client, so the stream still runs through
// EventSource and every assertion about phases and cancellation still means
// something; only the rendering is stubbed, which jsdom has no GPU for anyway.

import { createClient, createTimelineState } from '@codecity/city';
import type { TimelineState, Manifest } from '@codecity/city';

// The imports below reach past the package's public surface on purpose, and
// say so by path: they are its internal wiring, which no consumer needs and
// which these tests assemble by hand. A test may reach in; nothing in src/ may.
import { createEmitter } from '../../../city/src/events';
import { createSourceLoader } from '../../../city/src/loadSource';
import { refreshOnce, startWatch } from '../../../city/src/watch';
import { SCENE_HANDLE, type SceneHandle } from '@/state/stores/city';
import { attachScanToStores } from '@/hooks/useManifestSource';

export interface StubSceneCity {
  /** Whether a live-update watch is running on this city. */
  readonly watching: boolean;
  /** Every manifest the city was asked to render, in order. */
  applied: Manifest[];
  /** The history this city is showing — what the app's timeline store binds to. */
  timeline: TimelineState;
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
  const detach = attachScanToStores(events.on);
  const timeline = createTimelineState();

  let watching = false;

  const watchDeps = {
    client,
    loader,
    timeline,
    events,
    applyManifest: async (m: Manifest) => void applied.push(m),
    currentSignature: () => applied[applied.length - 1]?.content_signature ?? null,
  };

  SCENE_HANDLE.value = {
    on: events.on,
    client,
    loadSource: loader.load,
    cancelLoad: loader.cancel,
    applyManifest: async (m: Manifest) => void applied.push(m),
    // The real watch over the real loader and client, so a test that drives an
    // exclude edit or a poll exercises the city's own rules — which foreground
    // load wins, what a refresh must not apply — rather than a stand-in's.
    watchSource: (options) => {
      watching = true;
      const stop = startWatch(watchDeps, options);
      return () => {
        watching = false;
        stop();
      };
    },
    refreshSource: (options) => refreshOnce(watchDeps, options),
    timeline,
    dispose() {},
  } as unknown as SceneHandle;

  return {
    applied,
    /** Whether a watch is running on this city — what the host decides. */
    get watching() {
      return watching;
    },
    timeline,
    dispose(): void {
      detach();
      loader.dispose();
      timeline.dispose();
      events.clear();
      SCENE_HANDLE.value = null;
    },
  };
}
