// What a finished build owes the person looking at it: a city you can click, and
// a URL selection sitting centred. Both are properties of the REAL composer, not
// of any one part — stubbing a world whose meshes already exist is how a city you
// could only drag got shipped. jsdom has no WebGL, so only that is mocked.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { EMPTY_MANIFEST } from '../_helpers/manifestFixtures';
import { mkDir, mkFile } from '../_helpers/cityFixtures';
import { CURRENT_SOURCE, commitSource } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import { REBUILD_STATUS, RebuildStatus } from '@/state/stores/progress';
import { SCENE_HANDLE } from '@/city/sceneHandle';
import { PICKER_SELECTION_KEY } from '@/city/interaction/picker';
import { attachViewUrlReactions } from '@/router/viewBinding';
import { navigate } from '@/router/location';
import { ROUTES } from '@/router/paths';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('../_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer() };
});

vi.mock('@/city/render/postFx', async () => (await import('../_helpers/threeMock')).postFxMock());

// Icon images never fire onload in jsdom and would hang the apply.
vi.mock('@/city/components/buildings/atlas', async () => {
  const actual = await vi.importActual<typeof import('@/city/components/buildings/atlas')>(
    '@/city/components/buildings/atlas'
  );
  return { ...actual, buildIconAtlas: async () => null };
});

import { createCity } from '@/city/index';
import { Manifest, NodeKind } from '@/city/types/manifest';

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
    const handle = await createCity(makeCanvas());
    try {
      CURRENT_SOURCE.value = { src: 'test://repo' };
      await handle.applyManifest(makeManifest());
      await vi.waitFor(() => expect(REBUILD_STATUS.value).toBe(RebuildStatus.Idle));

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
    const handle = await createCity(makeCanvas());
    try {
      SCENE_HANDLE.value = handle;
      navigate('/city?src=test%3A%2F%2Frepo&sel=file:src/a.ts', { replace: true });
      stopUrlBinding = attachViewUrlReactions();

      const manifest = makeManifest();
      commitSource('test://repo', undefined, manifest);
      MANIFEST.value = manifest;
      await handle.applyManifest(manifest);
      await vi.waitFor(() => expect(REBUILD_STATUS.value).toBe(RebuildStatus.Idle));

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
      handle.dispose();
    }
  });
});
