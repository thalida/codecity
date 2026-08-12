// city/interaction/inputHandlers.test.ts — the scene's document-level keydown
// handler must not fire scene keybindings (Esc-deselect, R, F) while a modal
// (Shortcuts/Debug/ProjectsView) is open. The handler bails out early when the
// OVERLAY_OPEN signal is set — see the "modal owns keyboard input" guard in
// inputHandlers.ts, right after the text-input early-return.
//
// Exercises the guard through the real createCity → createInputHandlers path
// (same jsdom mocking setup as city/index.test.ts) rather than reimplementing
// a fake picker/rig, so the assertion covers the actual DOM listener wiring.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMPTY_MANIFEST } from '@/constants/manifest';
import { openShortcuts, closeShortcuts } from '@/state/stores/ui';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('../../_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer() };
});

vi.mock('@/city/render/postFx', async () =>
  (await import('../../_helpers/threeMock')).postFxMock()
);

import { createCity } from '@/city/index';

describe('scene keydown handler — modal suppression', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    let calls = 0;
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        if (calls++ < 8) setTimeout(() => cb(performance.now()), 0);
        return 0 as unknown as number;
      });
  });

  afterEach(() => {
    rafSpy.mockRestore();
    vi.clearAllMocks();
    closeShortcuts();
  });

  function makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 720, configurable: true });
    return canvas;
  }

  it('ignores Escape (and other scene keybindings) while a modal is open', async () => {
    const handle = await createCity(makeCanvas(), EMPTY_MANIFEST);
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
});
