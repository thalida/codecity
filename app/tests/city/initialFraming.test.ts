// Regression for issue #62: the camera must snap to a NEW source's city once it
// applies (not stay on the empty boot), and must NOT reframe on a same-source
// re-apply (live-update / config save). The snap rides cityRevision (every
// apply) so it catches the final reuse apply, gated on a CURRENT_SOURCE_KEY
// change.
//
// jsdom has no WebGL — mock the renderer + post pipeline like city/index.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { STREET_TIERS } from '@/state/stores/settings/streets';
import type { Manifest } from '@/types';
import { mkDir } from '../_helpers/cityFixtures';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class FakeWebGLRenderer {
    domElement: HTMLCanvasElement;
    constructor(opts: { canvas: HTMLCanvasElement }) {
      this.domElement = opts.canvas;
    }
    setPixelRatio() {}
    setSize() {}
    getSize(v: THREE.Vector2) {
      return v;
    }
    render() {}
    dispose() {}
    forceContextLoss() {}
    copyTextureToTexture() {}
    setRenderTarget() {}
    getContext() {
      return {};
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

vi.mock('@/city/render/postFx', () => ({
  createPostFx: () => ({
    render: () => {},
    setSize: () => {},
    refresh: () => {},
    dispose: () => {},
  }),
}));

// buildIconAtlas loads icon images, which never fire onload in jsdom and hang
// applyManifest. Icons are irrelevant to camera framing — stub it out.
vi.mock('@/city/components/buildings/atlas', async () => {
  const actual = await vi.importActual<typeof import('@/city/components/buildings/atlas')>(
    '@/city/components/buildings/atlas'
  );
  return { ...actual, buildIconAtlas: async () => null };
});

import { createCity } from '@/city/index';

describe('initial-load framing (issue #62)', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;
  const DEFAULT_TIERS = STREET_TIERS.peek();

  beforeEach(() => {
    CURRENT_SOURCE.value = null;
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 0 as unknown as number;
      });
  });

  afterEach(() => {
    rafSpy.mockRestore();
    CURRENT_SOURCE.value = null;
    STREET_TIERS.value = DEFAULT_TIERS;
    vi.clearAllMocks();
  });

  function makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 720, configurable: true });
    return canvas;
  }

  // Directory-only tree (no files → no buildings), so the framing is driven by
  // the root street width. 10 child dirs → root descendants_count 20 → a high
  // street tier, so the real city frames clearly differently from the empty boot
  // (root descendants 0 → the narrowest tier). STREET_TIERS can also be forced
  // to a single width below.
  function makeManifest(): Manifest {
    const tree = mkDir(
      'repo',
      Array.from({ length: 10 }, (_, i) => mkDir(`d${i}`, []))
    );
    return {
      ...EMPTY_MANIFEST,
      tree,
      tree_signature: 'sig-repo',
      layout_signature: 'sig-repo',
      signature: 'full-sig',
    } as unknown as Manifest;
  }

  // Force every street (incl. the root) to a single width, so a rebuild after
  // changing it deterministically moves the framing.
  function setRootWidth(width: number): void {
    STREET_TIERS.value = { TIERS: [{ min_descendants: 0, width }] };
  }

  it('frames the city on initial load, not the empty boot', async () => {
    const handle = await createCity(makeCanvas(), EMPTY_MANIFEST);
    try {
      // firstFrame framed the empty boot (no source committed yet → no snap).
      const bootPos = handle.rig.camera.position.clone();

      // The fetch layer commits the source, then the real manifest applies.
      CURRENT_SOURCE.value = { src: 'test://repo' };
      await handle.applyManifest(makeManifest());
      const loadPos = handle.rig.camera.position.clone();

      // What R produces now = the real city's framing.
      handle.rig.reset();
      const resetPos = handle.rig.camera.position.clone();

      // Sanity: the city frames differently from the empty boot.
      expect(resetPos.distanceTo(bootPos)).toBeGreaterThan(1);
      // The camera snapped to the city on load — no manual R needed.
      expect(loadPos.distanceTo(resetPos)).toBeLessThan(0.5);
    } finally {
      handle.dispose();
    }
  });

  it('does not reframe on a same-source re-apply (live-update / config save)', async () => {
    setRootWidth(100);
    const handle = await createCity(makeCanvas(), EMPTY_MANIFEST);
    try {
      CURRENT_SOURCE.value = { src: 'test://repo' };
      const m = makeManifest();
      await handle.applyManifest(m);
      const posLoaded = handle.rig.camera.position.clone();

      // A same-source rebuild that moves the framing (here a Rebuild-route
      // setting + invalidate; a live-update is the same shape) must leave the
      // camera where it is — the source key didn't change.
      setRootWidth(500);
      handle.invalidateLayoutCache();
      await handle.applyManifest(m);
      expect(handle.rig.camera.position.distanceTo(posLoaded)).toBeLessThan(0.5);

      // Confirm the framing genuinely changed (R re-frames to the new width).
      handle.rig.reset();
      expect(handle.rig.camera.position.distanceTo(posLoaded)).toBeGreaterThan(1);
    } finally {
      handle.dispose();
    }
  });
});
