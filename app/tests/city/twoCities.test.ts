// Two cities, mounted at once, must not be able to hear each other. Everything
// app-wide a city touches is injected (see city/bindings.ts), so the second one
// below is given nothing at all: it builds, frames and disposes in silence
// while the first drives the status, the framing and the scrub the app reads.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMPTY_MANIFEST } from '../_helpers/manifestFixtures';
import { mkDir, mkFile } from '../_helpers/cityFixtures';
import { RebuildStatus } from '@/state/stores/progress';
import { SourceKind } from '@/utils/sources';
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

import { createCityScene } from '@/city/index';
import { makeSession } from '../_helpers/city';
import { cityPropsFor } from '@/city/forSession';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

const W = 800;
const H = 600;

describe('two cities at once', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    session.source.current.value = null;
    session.manifest.current.value = null;
    session.timeline.mode.value = false;
    session.progress.rebuildStatus.value = RebuildStatus.Pending;
    session.progress.builtManifest.value = null;
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 0 as unknown as number;
      });
  });

  afterEach(() => {
    rafSpy.mockRestore();
    session.source.current.value = null;
    session.manifest.current.value = null;
    session.timeline.mode.value = false;
    session.progress.rebuildStatus.value = RebuildStatus.Pending;
    session.progress.builtManifest.value = null;
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
    const scenery = await createCityScene(makeCanvas());
    try {
      await scenery.applyManifest(makeManifest('wallpaper'));

      expect(scenery.manifest.value, 'it did build').not.toBeNull();
      expect(session.progress.rebuildStatus.value, 'nobody was told').toBe(RebuildStatus.Pending);
      expect(session.progress.builtManifest.value).toBeNull();
      expect(session.progress.buildProgress.value).toBeNull();
    } finally {
      scenery.dispose();
    }
  });

  it('holds the bound one’s "on screen" while the unbound one builds beside it', async () => {
    const world = await createCityScene(makeCanvas(), cityPropsFor(session));
    const scenery = await createCityScene(makeCanvas());
    try {
      session.source.current.value = { src: 'test://repo' };
      session.manifest.current.value = makeManifest('repo');
      await world.applyManifest(makeManifest('repo'));
      await vi.waitFor(() => expect(session.progress.rebuildStatus.value).toBe(RebuildStatus.Idle));

      // Sampled DURING the wallpaper's build: a build opens its readout before
      // it yields, so a coupled one is visible here and nowhere later.
      const scenic = scenery.applyManifest(makeManifest('wallpaper'));
      expect(session.progress.rebuildStatus.value, 'the world is still what is on screen').toBe(
        RebuildStatus.Idle
      );
      expect(session.progress.buildProgress.value, 'and nothing claims to be building').toBeNull();
      await scenic;

      expect(scenery.manifest.value?.tree?.name).toBe('wallpaper');
      expect(world.manifest.value?.tree?.name).toBe('repo');
    } finally {
      scenery.dispose();
      world.dispose();
    }
  });

  it('leaves the unbound one alone when Timeline mode exits', async () => {
    const scenery = await createCityScene(makeCanvas());
    try {
      await scenery.applyManifest(makeManifest('wallpaper'));
      scenery.timeline.installScrubController(new Map(), []);
      const uninstall = vi.spyOn(scenery.timeline, 'uninstallScrubController');
      // The live manifest a Timeline exit would rebuild from: a DIFFERENT repo,
      // which is what used to land on the landing's wallpaper.
      session.manifest.current.value = makeManifest('repo');

      session.timeline.mode.value = true;
      session.timeline.mode.value = false;

      expect(uninstall).not.toHaveBeenCalled();
      expect(scenery.manifest.value?.tree?.name).toBe('wallpaper');
    } finally {
      scenery.dispose();
    }
  });

  // The point of a session: two projects loading and scrubbing at once. One
  // MANIFEST and one scan meant the second repo overwrote the first.
  it('runs two projects at once without either seeing the other', async () => {
    const left = makeSession();
    const right = makeSession();
    try {
      left.source.current.value = { src: 'test://left' };
      right.source.current.value = { src: 'test://right' };
      left.manifest.set(makeManifest('left'));
      right.manifest.set(makeManifest('right'));

      // One scans while the other is idle, one scrubs while the other is live.
      left.progress.scan.value = { kind: SourceKind.Local, phase: null };
      right.progress.reporter.markIdle();
      right.timeline.mode.value = true;
      right.timeline.setScrubPos(3);

      expect(left.progress.scan.value, 'left is still loading').not.toBeNull();
      expect(right.progress.scan.value, 'and right never started').toBeNull();
      expect(left.progress.rebuildStatus.value).toBe(RebuildStatus.Pending);
      expect(right.progress.rebuildStatus.value).toBe(RebuildStatus.Idle);
      expect(left.timeline.mode.value, 'only one of them is scrubbing').toBe(false);
      expect(left.timeline.scrubPos.value).toBe(0);
      expect(left.manifest.current.value).not.toBe(right.manifest.current.value);
      expect(left.source.isOpen('test://right')).toBe(false);
    } finally {
      left.dispose();
      right.dispose();
    }
  });

  it('holds the unbound one’s camera when the opened project changes', async () => {
    const scenery = await createCityScene(makeCanvas());
    try {
      session.source.current.value = { src: 'test://one' };
      await scenery.applyManifest(makeManifest('wallpaper'));
      // Spied after the first apply: framing the city it just got IS its job.
      const refit = vi.spyOn(scenery.rig, 'reset');

      // A source switch refits the city that IS that source. This one is a
      // picture of something else, and its camera is not the app's to move.
      session.source.current.value = { src: 'test://two' };
      await scenery.applyManifest(makeManifest('wallpaper'));

      expect(refit).not.toHaveBeenCalled();
    } finally {
      scenery.dispose();
    }
  });
});
