// Regression for issue #62: a post-load layout rebuild (per-source settings
// hydrating on a same-source apply) changed the framing, but the source-change
// snap didn't re-fire, so the initial frame differed from R. The camera should
// follow the framing until the user first takes control. Reproduced here via a
// STREET_TIERS change + rebuild (the same path) and a synthesized 'start' event.
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

  // Directory-only tree (no files → no buildings), so the framing is driven
  // purely by the root street width — which we control via STREET_TIERS below.
  function makeManifest(): Manifest {
    const tree = mkDir('repo', [mkDir('a', [mkDir('b', [])]), mkDir('c', []), mkDir('d', [])]);
    return {
      ...EMPTY_MANIFEST,
      tree,
      tree_signature: 'sig-repo',
      signature: 'full-sig',
    } as unknown as Manifest;
  }

  // Force every street (incl. the root) to a single width, so a rebuild after
  // changing it deterministically moves the framing.
  function setRootWidth(width: number): void {
    STREET_TIERS.value = { TIERS: [{ min_descendants: 0, width }] };
  }

  it('re-snaps when a post-load rebuild changes the framing, before the user interacts', async () => {
    setRootWidth(100);
    const handle = await createCity(makeCanvas(), EMPTY_MANIFEST);
    try {
      // Source commits, then the first real manifest applies → initial frame.
      CURRENT_SOURCE.value = { src: 'test://repo' };
      const m = makeManifest();
      await handle.applyManifest(m);
      const posInitial = handle.rig.camera.position.clone();

      // Per-source settings hydrate: a Rebuild-route setting flips and the
      // layout is rebuilt for the SAME source. The framing changes.
      setRootWidth(400);
      handle.invalidateLayoutCache();
      await handle.applyManifest(m);
      const posAfterRebuild = handle.rig.camera.position.clone();

      // The rebuild's framing = what R would produce now.
      handle.rig.reset();
      const posReset = handle.rig.camera.position.clone();

      // Sanity: the rebuild actually changed the framing.
      expect(posReset.distanceTo(posInitial)).toBeGreaterThan(1);
      // Fix: the camera followed the rebuild to the settled framing — no manual R
      // needed. Before the fix it stayed at posInitial (the pre-hydration frame).
      expect(posAfterRebuild.distanceTo(posReset)).toBeLessThan(0.5);
    } finally {
      handle.dispose();
    }
  });

  it('stops following once the user takes control of the camera', async () => {
    setRootWidth(100);
    const handle = await createCity(makeCanvas(), EMPTY_MANIFEST);
    try {
      CURRENT_SOURCE.value = { src: 'test://repo' };
      const m = makeManifest();
      await handle.applyManifest(m);

      // User grabs the camera (orbit/pan/zoom all emit OrbitControls 'start').
      handle.rig.controls.dispatchEvent({ type: 'start' } as unknown as never);
      const posBeforeRebuild = handle.rig.camera.position.clone();

      // A later settings rebuild must NOT yank the user's view.
      setRootWidth(600);
      handle.invalidateLayoutCache();
      await handle.applyManifest(m);
      const posAfterRebuild = handle.rig.camera.position.clone();

      expect(posAfterRebuild.distanceTo(posBeforeRebuild)).toBeLessThan(0.5);

      // Confirm the framing genuinely would have changed (R still re-frames).
      handle.rig.reset();
      const posReset = handle.rig.camera.position.clone();
      expect(posReset.distanceTo(posBeforeRebuild)).toBeGreaterThan(1);
    } finally {
      handle.dispose();
    }
  });
});
