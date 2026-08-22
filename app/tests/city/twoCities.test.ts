// Two cities, mounted at once, must not be able to hear each other. Everything
// app-wide a city touches is injected (see city/bindings.ts), so the second one
// below is given nothing at all: it builds, frames and disposes in silence
// while the first drives the status, the framing and the scrub the app reads.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMPTY_MANIFEST } from '../_helpers/manifestFixtures';
import { mkDir, mkFile } from '../_helpers/cityFixtures';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import { TIMELINE_MODE } from '@/state/stores/timeline';
import {
  REBUILD_STATUS,
  RebuildStatus,
  BUILT_MANIFEST,
  BUILD_PROGRESS,
} from '@/state/stores/progress';
import type { Manifest } from '@/types';

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
import { OPENED_PROJECT } from '@/city/openedProject';

const W = 800;
const H = 600;

describe('two cities at once', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    CURRENT_SOURCE.value = null;
    MANIFEST.value = null;
    TIMELINE_MODE.value = false;
    REBUILD_STATUS.value = RebuildStatus.Pending;
    BUILT_MANIFEST.value = null;
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
    MANIFEST.value = null;
    TIMELINE_MODE.value = false;
    REBUILD_STATUS.value = RebuildStatus.Pending;
    BUILT_MANIFEST.value = null;
  });

  function makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: W, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: H, configurable: true });
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0 }) as DOMRect;
    return canvas;
  }

  function makeManifest(name: string): Manifest {
    return {
      ...EMPTY_MANIFEST,
      tree: mkDir(name, [mkDir('src', [mkFile('a.ts'), mkFile('b.ts')])]),
      structure_signature: `structure-${name}`,
      layout_signature: `layout-${name}`,
      content_signature: `content-${name}`,
    } as unknown as Manifest;
  }

  it('builds the unbound one without touching the status the bound one owns', async () => {
    const scenery = await createCity(makeCanvas());
    try {
      await scenery.applyManifest(makeManifest('wallpaper'));

      expect(scenery.manifest.value, 'it did build').not.toBeNull();
      expect(REBUILD_STATUS.value, 'nobody was told').toBe(RebuildStatus.Pending);
      expect(BUILT_MANIFEST.value).toBeNull();
      expect(BUILD_PROGRESS.value).toBeNull();
    } finally {
      scenery.dispose();
    }
  });

  it('holds the bound one’s "on screen" while the unbound one builds beside it', async () => {
    const world = await createCity(makeCanvas(), OPENED_PROJECT);
    const scenery = await createCity(makeCanvas());
    try {
      CURRENT_SOURCE.value = { src: 'test://repo' };
      MANIFEST.value = makeManifest('repo');
      await world.applyManifest(makeManifest('repo'));
      await vi.waitFor(() => expect(REBUILD_STATUS.value).toBe(RebuildStatus.Idle));

      // Sampled DURING the wallpaper's build: a build opens its readout before
      // it yields, so a coupled one is visible here and nowhere later.
      const scenic = scenery.applyManifest(makeManifest('wallpaper'));
      expect(REBUILD_STATUS.value, 'the world is still what is on screen').toBe(RebuildStatus.Idle);
      expect(BUILD_PROGRESS.value, 'and nothing claims to be building').toBeNull();
      await scenic;

      expect(scenery.manifest.value?.tree?.name).toBe('wallpaper');
      expect(world.manifest.value?.tree?.name).toBe('repo');
    } finally {
      scenery.dispose();
      world.dispose();
    }
  });

  it('leaves the unbound one alone when Timeline mode exits', async () => {
    const scenery = await createCity(makeCanvas());
    try {
      await scenery.applyManifest(makeManifest('wallpaper'));
      scenery.timeline.installScrubController(new Map(), []);
      const uninstall = vi.spyOn(scenery.timeline, 'uninstallScrubController');
      // The live manifest a Timeline exit would rebuild from: a DIFFERENT repo,
      // which is what used to land on the landing's wallpaper.
      MANIFEST.value = makeManifest('repo');

      TIMELINE_MODE.value = true;
      TIMELINE_MODE.value = false;

      expect(uninstall).not.toHaveBeenCalled();
      expect(scenery.manifest.value?.tree?.name).toBe('wallpaper');
    } finally {
      scenery.dispose();
    }
  });

  it('holds the unbound one’s camera when the opened project changes', async () => {
    const scenery = await createCity(makeCanvas());
    try {
      CURRENT_SOURCE.value = { src: 'test://one' };
      await scenery.applyManifest(makeManifest('wallpaper'));
      // Spied after the first apply: framing the city it just got IS its job.
      const refit = vi.spyOn(scenery.rig, 'reset');

      // A source switch refits the city that IS that source. This one is a
      // picture of something else, and its camera is not the app's to move.
      CURRENT_SOURCE.value = { src: 'test://two' };
      await scenery.applyManifest(makeManifest('wallpaper'));

      expect(refit).not.toHaveBeenCalled();
    } finally {
      scenery.dispose();
    }
  });
});
