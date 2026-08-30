// inputHandlers.test.ts — the scene's keybindings must not fire while a modal
// owns the keyboard. Driven through the real City.create path, so it covers the
// actual listener wiring rather than a stand-in for it.

import { City, NodeKind } from '@codecity/city';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  openShortcuts,
  closeShortcuts,
  SELECTION_PANE_DISMISSED,
} from '@/features/city/state/modals';
import {
  SCENE_HANDLE,
  attachCityChrome,
  cityKeyboardEnabled,
} from '@/features/settings/state/values/city';
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

describe('scene keydown handler — modal suppression', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;
  // Every city binds its own document keydown listener, so one left standing
  // answers the next test's keystroke too.
  let cities: Array<Awaited<ReturnType<typeof City.create>>> = [];

  beforeEach(() => {
    // Over a city: home IS the switcher, which owns the keyboard.
    navigate(ROUTES.CITY, { replace: true });
    let calls = 0;
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        if (calls++ < 8) setTimeout(() => cb(performance.now()), 0);
        return 0 as unknown as number;
      });
  });

  afterEach(() => {
    cities.forEach((c) => c.dispose());
    cities = [];
    rafSpy.mockRestore();
    vi.clearAllMocks();
    closeShortcuts();
    navigate(ROUTES.HOME, { replace: true });
    SCENE_HANDLE.value = null;
    SELECTION_PANE_DISMISSED.value = false;
  });

  // Mounted the way City.tsx mounts one, so the keyboard gate and the chrome
  // reactions under test are the same wiring the app ships.
  async function mountCity() {
    const handle = await City.create(makeCanvas(), { keyboard: cityKeyboardEnabled });
    chromeOff = attachCityChrome(handle.on);
    cities.push(handle);
    return handle;
  }

  function makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 720, configurable: true });
    return canvas;
  }

  let chromeOff: (() => void) | null = null;
  afterEach(() => {
    chromeOff?.();
    chromeOff = null;
  });

  it('ignores Escape (and other scene keybindings) while a modal is open', async () => {
    const handle = await mountCity();
    const setSelectionSpy = vi.spyOn(handle.picker, 'setSelection');

    // Open a modal — OVERLAY_OPEN goes true, so the scene handler bails.
    openShortcuts();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(setSelectionSpy).not.toHaveBeenCalled();

    // Once it closes, the same key reaches the scene handler again.
    closeShortcuts();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(setSelectionSpy).toHaveBeenCalledWith(null);
  });

  // F and a pane's Focus button are the same request, so the key goes through
  // the same command — including putting the panel away to uncover the city.
  it("focuses the selection on F and leaves the chip in the panel's place", async () => {
    const handle = await mountCity();
    SCENE_HANDLE.value = handle;
    const focusSpy = vi.spyOn(handle.rig, 'focusSelection').mockImplementation(() => {});
    handle.picker.setSelection({
      kind: NodeKind.Commit,
      commit: { sha: 'a'.repeat(40) },
      mesh: {},
      instanceId: 0,
    } as never);
    expect(SELECTION_PANE_DISMISSED.value).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(SELECTION_PANE_DISMISSED.value).toBe(true);
    // The selection itself survives: the chip has something to name.
    expect(handle.picker.selection).not.toBeNull();
  });

  it('ignores F with nothing selected, panel included', async () => {
    const handle = await mountCity();
    SCENE_HANDLE.value = handle;
    const focusSpy = vi.spyOn(handle.rig, 'focusSelection').mockImplementation(() => {});

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));

    expect(focusSpy).not.toHaveBeenCalled();
    expect(SELECTION_PANE_DISMISSED.value).toBe(false);
  });
});
