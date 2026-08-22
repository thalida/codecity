// The composer: what createCity returns, and that dispose releases the WebGL
// context rather than just its resources.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { forceContextLossSpy } = vi.hoisted(() => ({ forceContextLossSpy: vi.fn() }));

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  const { fakeWebGLRenderer } = await import('../_helpers/threeMock');
  return { ...actual, WebGLRenderer: fakeWebGLRenderer(forceContextLossSpy) };
});

vi.mock('@/city/render/postFx', async () => (await import('../_helpers/threeMock')).postFxMock());

import { createCity } from '@/city/index';
import { makeSession } from '../_helpers/project';
import { cityPropsFor } from '@/city/forProject';

// One project for this file, the way the app makes one for itself.
const session = makeSession();

describe('createCity', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The stub must fire its callback (the decoration pass awaits a real rAF),
    // and cap invocations, since the frame loop self-arms the same way.
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
    session.timeline.mode.value = false;
  });

  function makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    // jsdom returns 0 for clientWidth/Height; give the rig a non-degenerate
    // viewport so aspect math doesn't divide by zero.
    Object.defineProperty(canvas, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 720, configurable: true });
    return canvas;
  }

  it('builds with no manifest and returns the expected handle shape', async () => {
    const handle = await createCity(makeCanvas(), cityPropsFor(session));

    expect(handle.world).toBeDefined();
    expect(handle.picker).toBeDefined();
    expect(handle.rig).toBeDefined();
  });

  it('dispose() releases the WebGL context (forceContextLoss), not just its resources', async () => {
    const handle = await createCity(makeCanvas(), cityPropsFor(session));
    expect(forceContextLossSpy).not.toHaveBeenCalled();
    handle.dispose();
    expect(forceContextLossSpy).toHaveBeenCalled();
  });

  // loadSource flips TIMELINE_MODE off without touching the scene, so this
  // effect is the only thing that tears the union city down.
  describe('Timeline-mode scene teardown', () => {
    // Only the uninstall is asserted here: the rebuild it triggers needs a
    // populated manifest to observe, which this harness does not build.
    it('reacts to TIMELINE_MODE going true→false by uninstalling the controller', async () => {
      const handle = await createCity(makeCanvas(), cityPropsFor(session));
      handle.timeline.installScrubController(new Map(), []);
      const uninstallSpy = vi.spyOn(handle.timeline, 'uninstallScrubController');

      session.timeline.mode.value = true; // entering must not trip the teardown
      expect(uninstallSpy).not.toHaveBeenCalled();

      session.timeline.mode.value = false; // same flip a source switch performs
      expect(uninstallSpy).toHaveBeenCalledTimes(1);

      handle.dispose();
    });

    it('no-ops when no controller was ever installed', async () => {
      const handle = await createCity(makeCanvas(), cityPropsFor(session));
      const uninstallSpy = vi.spyOn(handle.timeline, 'uninstallScrubController');

      session.timeline.mode.value = true;
      session.timeline.mode.value = false;

      expect(uninstallSpy).not.toHaveBeenCalled();
      handle.dispose();
    });
  });
});
