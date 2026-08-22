// inputHandlers.test.ts — the scene's keybindings must not fire while a modal
// owns the keyboard. Driven through the real createCityScene path, so it covers the
// actual listener wiring rather than a stand-in for it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openShortcuts, closeShortcuts, SELECTION_PANE_DISMISSED } from '@/state/stores/chrome';
import { navigate } from '@/router/location';
import { ROUTES } from '@/router/paths';
import { NodeKind } from '@/types';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('../../_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer() };
});

vi.mock('@/city/render/postFx', async () =>
  (await import('../../_helpers/threeMock')).postFxMock()
);

import { createCityScene } from '@/city/index';
import { makeSession } from '../../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

describe('scene keydown handler — modal suppression', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;
  // Every city binds its own document keydown listener, so one left standing
  // answers the next test's keystroke too.
  let cities: Array<Awaited<ReturnType<typeof createCityScene>>> = [];

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
    session.scene.value = null;
    SELECTION_PANE_DISMISSED.value = false;
  });

  async function mountCity() {
    const handle = await createCityScene(makeCanvas(), session);
    cities.push(handle);
    return handle;
  }

  function makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 720, configurable: true });
    return canvas;
  }

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
    session.scene.value = handle;
    const focusSpy = vi.spyOn(handle.rig, 'focusSelection').mockImplementation(() => {});
    handle.picker.selection.value = {
      kind: NodeKind.Commit,
      commit: { sha: 'a'.repeat(40) },
      mesh: {},
      instanceId: 0,
    } as never;
    expect(SELECTION_PANE_DISMISSED.value).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(SELECTION_PANE_DISMISSED.value).toBe(true);
    // The selection itself survives: the chip has something to name.
    expect(handle.picker.selection.value).not.toBeNull();
  });

  it('ignores F with nothing selected, panel included', async () => {
    const handle = await mountCity();
    session.scene.value = handle;
    const focusSpy = vi.spyOn(handle.rig, 'focusSelection').mockImplementation(() => {});

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));

    expect(focusSpy).not.toHaveBeenCalled();
    expect(SELECTION_PANE_DISMISSED.value).toBe(false);
  });
});
