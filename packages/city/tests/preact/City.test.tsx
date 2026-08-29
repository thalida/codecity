// The component's bindings. What makes it a COMPONENT rather than a mount
// script: props are live, so changing one tells the city, and the instance
// comes back out so a host can do what props cannot express.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('../_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer() };
});
vi.mock('../../src/render/postFx', async () =>
  (await import('../_helpers/threeMock')).postFxMock()
);

import { City as CityCanvas } from '../../src/preact/index';
import { EMPTY_MANIFEST } from '../_helpers/manifestFixtures';
import { mkDir, mkFile } from '../_helpers/cityFixtures';
import { encodeSelection, decodeSelection } from '../../src/state/viewState';
import type { CityViewState } from '../../src/state/viewState';
import type { Manifest } from '../../src/types/manifest';
import type { City as CityInstance } from '@codecity/city';

const settle = () => new Promise<void>((r) => setTimeout(r, 0));
/** Wait for a condition rather than for a number of ticks. createCity is async,
 *  and the effects that follow it run after the render its result triggers, so
 *  counting turns is a guess that holds until the machine is busy. */
function until(what: string, done: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (done()) return resolve();
      if (Date.now() - started > 3000) return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(check, 5);
    };
    check();
  });
}

const whenReady = (fn: { mock: { calls: unknown[][] } }) =>
  until('the city', () => fn.mock.calls.some(([c]) => c !== null));

describe('<CityCanvas>', () => {
  let host: HTMLDivElement;
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    let calls = 0;
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        if (calls++ < 20) setTimeout(() => cb(performance.now()), 0);
        return 0 as unknown as number;
      });
    // jsdom gives a canvas no box; the rig needs a non-degenerate viewport.
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
      value: 1280,
      configurable: true,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
      value: 720,
      configurable: true,
    });
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    rafSpy.mockRestore();
  });

  /** Mount and wait for the city, which is built asynchronously. */
  async function mount(props: Record<string, unknown> = {}) {
    let city: CityInstance | null = null;
    const onReady = vi.fn((c: CityInstance | null) => void (city = c));
    render(<CityCanvas {...props} onReady={onReady} />, host);
    await whenReady(onReady);
    return { onReady, city: () => city };
  }

  it('renders a canvas and hands back the city it built', async () => {
    const m = await mount();
    expect(host.querySelector('canvas.codecity-canvas')).not.toBeNull();
    expect(m.city()).not.toBeNull();
  });

  // A screen reader gets a description of what the canvas is, and a host can
  // say something better for its own page.
  it('describes itself, and lets a host override that', async () => {
    await mount();
    const canvas = host.querySelector('canvas')!;
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toMatch(/3D city/);

    render(null, host);
    render(<CityCanvas aria-label="A map of my repo" />, host);
    await settle();
    expect(host.querySelector('canvas')!.getAttribute('aria-label')).toBe('A map of my repo');
  });

  it('is opaque by default and transparent when asked', async () => {
    await mount();
    expect(host.querySelector('canvas')!.className).toContain('codecity-canvas--opaque');

    render(null, host);
    render(<CityCanvas transparent />, host);
    await settle();
    expect(host.querySelector('canvas')!.className).toContain('codecity-canvas--transparent');
  });

  // The binding that makes it a component: change the prop, the city is told.
  it('pushes settings when they change', async () => {
    const m = await mount({ settings: { TREES: { ENABLED: true } } });
    expect(m.city()!.settings.TREES.ENABLED).toBe(true);

    render(<CityCanvas settings={{ TREES: { ENABLED: false } }} onReady={m.onReady} />, host);
    await until('the new value', () => m.city()?.settings.TREES.ENABLED === false);

    expect(m.city()!.settings.TREES.ENABLED).toBe(false);
  });

  it('reports what it is doing, starting with the current answer', async () => {
    const onStatus = vi.fn();
    render(<CityCanvas onStatus={onStatus} />, host);
    await until('a status report', () => onStatus.mock.calls.length > 0);
    // Called immediately as well as on change: a host rendering off status
    // wants the current one, not only the next.
    expect(onStatus).toHaveBeenCalled();
  });

  it('hands back null when it goes, so a host can drop its own state', async () => {
    const m = await mount();
    expect(m.city()).not.toBeNull();

    render(null, host);
    await settle();

    expect(m.onReady).toHaveBeenLastCalledWith(null);
  });

  // Nothing else holds a reference to a city, so an orphan leaks its renderer
  // and frame loop for the life of the page.
  it('disposes a city whose host unmounted before it finished building', async () => {
    const onReady = vi.fn();
    render(<CityCanvas onReady={onReady} />, host);
    render(null, host); // unmounted while createCity is still resolving
    await settle();

    const built = onReady.mock.calls.filter(([c]) => c !== null);
    expect(built).toHaveLength(0);
  });

  it('does not rebuild the city when a callback identity changes', async () => {
    const m = await mount();
    const first = m.city();

    render(<CityCanvas onReady={m.onReady} onStatus={() => {}} />, host);
    await settle();

    expect(m.city()).toBe(first);
  });
});

// A host should be able to wire its chrome to a city through PROPS. Reaching
// for the instance is the escape hatch, not the way a selection reaches a pane.
describe('what a host gets without touching the instance', () => {
  let host: HTMLDivElement;
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    let calls = 0;
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        if (calls++ < 40) setTimeout(() => cb(performance.now()), 0);
        return 0 as unknown as number;
      });
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
      value: 1280,
      configurable: true,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
      value: 720,
      configurable: true,
    });
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    rafSpy.mockRestore();
  });

  /** A mounted city with something in it to select. */
  async function showing(extra: Record<string, unknown> = {}) {
    const got: { city: CityInstance | null } = { city: null };
    render(<CityCanvas onReady={(c) => void (got.city = c)} {...extra} />, host);
    await until('the city', () => got.city !== null);
    await got.city!.applyManifest({
      ...EMPTY_MANIFEST,
      tree: mkDir('root', [mkFile('a.ts'), mkFile('b.ts')]),
    } as unknown as Manifest);
    return got.city!;
  }

  it('reports the selection as a prop, with no instance in the host’s hands', async () => {
    const seen: Array<string | null> = [];
    const city = await showing({
      onSelect: (t: { file?: { path: string } } | null) => seen.push(t?.file?.path ?? null),
    });

    city.picker.selectByPath('root/a.ts');
    await until('a selection report', () => seen.length > 0);

    expect(seen).toContain('root/a.ts');
  });

  it('reports where the reader is, so a host can put it in a link', async () => {
    const views: CityViewState[] = [];
    const city = await showing({ onViewStateChange: (v: CityViewState) => views.push(v) });

    city.picker.selectByPath('root/a.ts');
    await until('a view report', () => views.length > 0);

    expect(encodeSelection(views[views.length - 1].selection ?? null)).toBe('file:root/a.ts');
  });

  it('goes where a viewState prop says, and ignores its own report coming back', async () => {
    const views: CityViewState[] = [];
    const got: { city: CityInstance | null } = { city: null };
    const view: CityViewState = { selection: decodeSelection('file:root/b.ts'), timeline: null };
    render(
      <CityCanvas
        onReady={(c) => void (got.city = c)}
        viewState={view}
        onViewStateChange={(v) => views.push(v)}
      />,
      host
    );
    await until('the city', () => got.city !== null);
    await got.city!.applyManifest({
      ...EMPTY_MANIFEST,
      tree: mkDir('root', [mkFile('a.ts'), mkFile('b.ts')]),
    } as unknown as Manifest);

    await until('the restore', () => got.city!.picker.selectionKey !== null);
    expect(encodeSelection(got.city!.picker.selectionKey)).toBe('file:root/b.ts');

    // The report the restore produced, fed back in, must not re-run the
    // restore: a controlled host reflects every change straight back.
    const before = views.length;
    render(
      <CityCanvas
        onReady={(c) => void (got.city = c)}
        viewState={views[views.length - 1] ?? view}
        onViewStateChange={(v) => views.push(v)}
      />,
      host
    );
    await settle();
    expect(views.length).toBe(before);
  });
});
