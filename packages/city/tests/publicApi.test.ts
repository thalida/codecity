// What a host can do with ONLY the public entry point.
//
// Every import here is from '../src/index' — the same specifier an installed
// consumer writes as '@codecity/city'. Nothing reaches a deep path, so a
// capability that quietly needs one fails here rather than in someone's app.
// This is examples/plain-js/main.js as a test: the same flow, asserted.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('./_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer() };
});
vi.mock('../src/render/postFx', async () => (await import('./_helpers/threeMock')).postFxMock());

import {
  createCity,
  CityLifecycle,
  CityPhase,
  EMPTY_CITY_STATUS,
  NodeKind,
  srcKind,
  SourceKind,
  sourceKey,
  defaultCitySettings,
  BuildStage,
  type City,
  type CityStatus,
  type CityViewState,
  type CityExtension,
  type Manifest,
} from '../src/index';

// Fixtures are the one thing a consumer gets from the testing entry, which is
// the other half of the public surface.
import { EMPTY_MANIFEST, mkDir, mkFile } from './index';

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe('a host with only @codecity/city', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    let calls = 0;
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        if (calls++ < 40) setTimeout(() => cb(performance.now()), 0);
        return 0 as unknown as number;
      });
  });
  afterEach(() => rafSpy.mockRestore());

  function makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 720, configurable: true });
    return canvas;
  }

  // The fixture is a PARTIAL manifest — metadata and history still to come —
  // which is what a scan applies first.
  const PARTIAL = {
    ...EMPTY_MANIFEST,
    tree: mkDir('root', [mkFile('a.ts'), mkFile('b.ts')]),
  } as unknown as Manifest;
  const REPO = { ...PARTIAL, pending: [] } as unknown as Manifest;

  /** The example's own sequence: make one, draw its status, show a repo. */
  async function mount(
    options: Parameters<typeof createCity>[1] = {},
    manifest: Manifest = REPO
  ): Promise<City> {
    const city = await createCity(makeCanvas(), { baseUrl: '/api', ...options });
    const onScreen = new Promise<void>((resolve) => {
      const off = city.on('build:done', () => {
        off();
        resolve();
      });
    });
    await city.applyManifest(manifest);
    await onScreen;
    await settle();
    return city;
  }

  it('can make one and read what it is doing, without subscribing first', async () => {
    const city = await createCity(makeCanvas(), { baseUrl: '/api' });
    const status: CityStatus = city.status;
    expect(status).toEqual(EMPTY_CITY_STATUS);
    expect(status.lifecycle).toBe(CityLifecycle.Empty);
    city.dispose();
  });

  it('can draw a readout from the status alone', async () => {
    const city = await mount();

    // Exactly what the example's renderStatus reads.
    const { lifecycle, fetching, phase, fraction } = city.status;
    expect(lifecycle).toBe(CityLifecycle.Ready);
    expect(fetching).toBe(false);
    expect(phase === null || Object.values(CityPhase).includes(phase)).toBe(true);
    expect(fraction === null || (fraction >= 0 && fraction <= 1)).toBe(true);

    city.dispose();
  });

  // The pair a host cannot express with one axis, and the one that reveals a
  // city about to grow trees: on screen, and not finished.
  it('can tell a city that is up from a city that is done', async () => {
    const city = await mount({}, PARTIAL);

    expect(city.status.lifecycle).toBe(CityLifecycle.Ready);
    expect(city.status.fetching).toBe(true);

    await city.applyManifest(REPO);
    await new Promise<void>((r) => setTimeout(r, 30));

    expect(city.status.fetching).toBe(false);
    city.dispose();
  });

  it('can re-render off one subscription that says what moved', async () => {
    const city = await mount();
    const moved: string[] = [];
    const off = city.onChange((change) => {
      if (change.selectionChanged) moved.push('selection');
      if (change.manifestChanged) moved.push('manifest');
    });

    city.picker.selectByPath('root/a.ts');
    await settle();

    expect(moved).toContain('selection');
    off();
    city.dispose();
  });

  it('can write the view down and put a reader back in it', async () => {
    const city = await mount();
    city.picker.selectByPath('root/a.ts');

    // Through JSON, the way a URL or a localStorage entry would carry it.
    const link: CityViewState = JSON.parse(JSON.stringify(city.getViewState()));
    city.picker.clearSelection();
    city.setViewState(link);

    expect(city.getViewState().selection).toEqual({ kind: NodeKind.File, path: 'root/a.ts' });
    city.dispose();
  });

  it('can add a layer of its own', async () => {
    let ticked = 0;
    const layer: CityExtension = () => ({
      group: new THREE.Group(),
      tick: () => void ticked++,
      dispose: () => {},
    });
    const city = await mount({ extensions: [layer] });
    await new Promise<void>((r) => setTimeout(r, 30));

    expect(ticked).toBeGreaterThan(0);
    city.dispose();
  });

  it('can push its own settings values in', async () => {
    const city = await mount();
    const stock = defaultCitySettings();

    city.updateSettings({ TREES: { ENABLED: !stock.TREES.ENABLED } });

    expect(city.settings.TREES.ENABLED).toBe(!stock.TREES.ENABLED);
    city.dispose();
  });

  it('can ask what a source string is, the way the city does', () => {
    expect(srcKind('https://github.com/o/r')).toBe(SourceKind.Remote);
    expect(srcKind('/repos/thing')).toBe(SourceKind.Local);
    // One answer to "which repo is this", shared with the city's own loader.
    expect(sourceKey('/repos/thing')).toBe(sourceKey('/repos/thing'));
    expect(sourceKey('/repos/thing')).not.toBe(sourceKey('/repos/other'));
  });

  it('can name the stages a build will run before asking for one', async () => {
    const city = await mount();
    const stages = city.buildStagesFor(REPO);

    expect(stages.length).toBeGreaterThan(0);
    for (const stage of stages) expect(Object.values(BuildStage)).toContain(stage);
    city.dispose();
  });

  it('can talk to the same server about the same repo', async () => {
    const city = await mount();
    // A host's own chrome — a file pane, a branch picker — should not build a
    // second client on a base it has to re-derive.
    expect(typeof city.client.apiUrl).toBe('function');
    city.dispose();
  });

  it('tears down everything it made', async () => {
    const city = await mount();
    const moved: string[] = [];
    city.onChange(() => moved.push('x'));

    city.dispose();
    city.picker.selectByPath('root/a.ts');
    await settle();

    expect(moved).toHaveLength(0);
  });
});
