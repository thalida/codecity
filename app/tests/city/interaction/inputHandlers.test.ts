// city/interaction/inputHandlers.test.ts — the scene's document-level keydown
// handler must not fire scene keybindings (Esc-deselect, R, F) while a modal
// (Shortcuts/Debug/SourcePicker) is open. Those modals all render
// `role="dialog" aria-modal="true"`, and the handler bails out early when one
// is present in the document — see the "modal owns keyboard input" guard in
// inputHandlers.ts, right after the text-input early-return.
//
// Exercises the guard through the real createCity → createInputHandlers path
// (same jsdom mocking setup as city/index.test.ts) rather than reimplementing
// a fake picker/rig, so the assertion covers the actual DOM listener wiring.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { EMPTY_MANIFEST } from '@/constants/manifest';

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
    document.querySelectorAll('[data-test-modal]').forEach((el) => el.remove());
  });

  function makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 720, configurable: true });
    return canvas;
  }

  it('ignores Escape (and other scene keybindings) while a role="dialog" aria-modal="true" element is open', async () => {
    const handle = await createCity(makeCanvas(), EMPTY_MANIFEST);
    const setSelectionSpy = vi.spyOn(handle.picker, 'setSelection');

    // Simulate a modal (ShortcutsModal/DebugModal/SourcePicker all render
    // this exact role/aria-modal pair) being open over the scene.
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('data-test-modal', '');
    document.body.appendChild(modal);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(setSelectionSpy).not.toHaveBeenCalled();

    // Once the modal closes (removed from the DOM), the same key reaches the
    // scene handler again.
    modal.remove();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(setSelectionSpy).toHaveBeenCalledWith(null);
  });
});
