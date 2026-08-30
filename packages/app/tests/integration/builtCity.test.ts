// What a finished build owes the person looking at it: a city you can click, and
// a URL selection sitting centred. Both are properties of the REAL composer, not
// of any one part — stubbing a world whose meshes already exist is how a city you
// could only drag got shipped. jsdom has no WebGL, so only that is mocked.

import { City, Manifest, NodeKind } from '@codecity/city';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { EMPTY_MANIFEST } from '@codecity/city/testing';
import { mkDir, mkFile } from '@codecity/city/testing';
import { CURRENT_SOURCE, commitSource } from '@/state/source';
import { MANIFEST } from '@/state/stores/manifest';
import { SCENE_HANDLE } from '@/features/settings/state/values/city';
import { PICKER_SELECTION_KEY } from '@/features/settings/state/values/city';
import { attachViewUrlReactions } from '@/router/viewBinding';
import { navigate } from '@/router/location';
import { ROUTES } from '@/router/location';

// The two mocks below reach past the package's public surface on purpose, and
// say so by path: they replace what jsdom has no implementation of (a WebGL
// post pipeline, an icon atlas that waits on image onload). There is no export
// for either, and there should not be — substituting a city's internals is a
// test's business, not an API.
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('@codecity/city/testing/three');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer() };
});

vi.mock('../../../city/src/render/postFx', async () =>
  (await import('@codecity/city/testing/three')).postFxMock()
);

// Icon images never fire onload in jsdom and would hang the apply.
vi.mock('../../../city/src/components/buildings/atlas', async () => {
  const actual = await vi.importActual<
    typeof import('../../../city/src/components/buildings/atlas')
  >('../../../city/src/components/buildings/atlas');
  return { ...actual, buildIconAtlas: async () => null };
});

import { nextBuild } from '@codecity/city/testing';
import { attachBuildProgress } from '@/features/city/state/overlay';
import { attachCityChrome } from '@/features/settings/state/values/city';

const W = 800;
const H = 600;

describe('a built city is pickable', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  let stopUrlBinding: (() => void) | null = null;

  beforeEach(() => {
    CURRENT_SOURCE.value = null;
    MANIFEST.value = null;
    PICKER_SELECTION_KEY.value = null;
    navigate(ROUTES.HOME, { replace: true });
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 0 as unknown as number;
      });
  });

  afterEach(() => {
    stopUrlBinding?.();
    stopUrlBinding = null;
    SCENE_HANDLE.value = null;
    rafSpy.mockRestore();
    CURRENT_SOURCE.value = null;
    MANIFEST.value = null;
    PICKER_SELECTION_KEY.value = null;
    vi.clearAllMocks();
  });

  function makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: W, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: H, configurable: true });
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0 }) as DOMRect;
    return canvas;
  }

  function makeManifest(): Manifest {
    return {
      ...EMPTY_MANIFEST,
      tree: mkDir('repo', [mkDir('src', [mkFile('a.ts'), mkFile('b.ts'), mkFile('c.ts')])]),
      structure_signature: 'sig-repo',
      layout_signature: 'sig-repo',
      content_signature: 'full-sig',
    } as unknown as Manifest;
  }

  it('picks the building under the cursor once the build has finished', async () => {
    const handle = await City.create(makeCanvas());
    try {
      CURRENT_SOURCE.value = { src: 'test://repo' };
      const built = nextBuild(handle);
      await handle.applyManifest(makeManifest());
      await built;

      // Where the city put that file, so the ray has something to aim at. The
      // pick itself goes through the meshes, which is what is under test.
      const placed = handle.picker.targetForPath('src/a.ts');
      expect(placed?.kind).toBe(NodeKind.File);
      const b = placed!.kind === NodeKind.File ? placed!.data : null;
      expect(b).not.toBeNull();

      handle.rig.camera.position.set(b!.x, 400, b!.y);
      handle.rig.camera.lookAt(b!.x, 0, b!.y);
      handle.rig.camera.updateMatrixWorld(true);

      const hit = handle.picker.pickAt(W / 2, H / 2);
      expect(hit).not.toBeNull();
      expect(hit!.object).toBeInstanceOf(THREE.InstancedMesh);

      const target = handle.picker.interpretHit(hit);
      expect(target?.kind).toBe(NodeKind.File);
      expect(target?.kind === NodeKind.File && target.file.path).toBe('src/a.ts');
    } finally {
      handle.dispose();
    }
  });

  // The load path end to end: URL → follow → selection → camera. The restore must
  // not swing overhead, so the pivot→camera offset survives the centring.
  it('centres a URL selection on the loaded framing, without turning the camera', async () => {
    const handle = await City.create(makeCanvas());
    let detachProgress: (() => void) | null = null;
    let detachChrome: (() => void) | null = null;
    try {
      SCENE_HANDLE.value = handle;
      // The URL follow waits on BUILT_MANIFEST, which the app sets when the
      // city reports it is up: this is the whole path, so it needs the app's
      // half of it wired the way City.tsx wires it.
      detachProgress = attachBuildProgress(handle);
      // The URL is written off the app's copy of the selection key, which this
      // keeps current — the same wiring City.tsx does.
      detachChrome = attachCityChrome(handle.on);
      navigate('/city?src=test%3A%2F%2Frepo&sel=file:src/a.ts', { replace: true });
      stopUrlBinding = attachViewUrlReactions();

      const manifest = makeManifest();
      commitSource('test://repo', undefined, manifest);
      MANIFEST.value = manifest;
      const built = nextBuild(handle);
      await handle.applyManifest(manifest);
      await built;

      const framedOffset = handle.rig.camera.position.clone().sub(handle.rig.controls.target);
      await vi.waitFor(() =>
        expect(PICKER_SELECTION_KEY.value).toEqual({ kind: NodeKind.File, path: 'src/a.ts' })
      );

      const placed = handle.picker.targetForPath('src/a.ts');
      const b = placed!.kind === NodeKind.File ? placed!.data : null;
      // Centred on the node…
      expect(handle.rig.controls.target.x).toBeCloseTo(b!.x, 1);
      expect(handle.rig.controls.target.z).toBeCloseTo(b!.y, 1);
      // …under the angle and distance the load framed.
      const restoredOffset = handle.rig.camera.position.clone().sub(handle.rig.controls.target);
      expect(restoredOffset.x).toBeCloseTo(framedOffset.x, 1);
      expect(restoredOffset.y).toBeCloseTo(framedOffset.y, 1);
      expect(restoredOffset.z).toBeCloseTo(framedOffset.z, 1);
    } finally {
      detachProgress?.();
      detachChrome?.();
      handle.dispose();
    }
  });
});
