// Per-frame call order and the rAF contract: exactly one frame queued at a
// time, and stop() cancels the pending one.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';

import { startFrameLoop } from '../../src/render/frameLoop';
import type { FrameContext, SceneComponent, SceneContext } from '../../src/types';

// Deterministic rAF: collect callbacks; the test flushes them manually.
let _rafCallbacks: Map<number, FrameRequestCallback>;
let _nextRafId: number;

function flushFrame(): void {
  const pending = [..._rafCallbacks.values()];
  _rafCallbacks.clear();
  for (const cb of pending) cb(performance.now());
}

// frameLoop reads only ctx.scene; the camera reaches it via perFrame.rig.
function makeCtx(): SceneContext {
  return { scene: new THREE.Scene() } as unknown as SceneContext;
}

// The rig owns the camera the loop projects through; every rig mock exposes it.
const CAMERA = new THREE.PerspectiveCamera();

function makeComponent(name: string, calls: string[]): SceneComponent {
  return {
    group: new THREE.Group(),
    tick: (_dt: number, _frame: FrameContext) => calls.push(name),
    dispose: () => {},
  };
}

describe('startFrameLoop()', () => {
  beforeEach(() => {
    _rafCallbacks = new Map();
    _nextRafId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
      const id = _nextRafId++;
      _rafCallbacks.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
      _rafCallbacks.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs the first frame synchronously in order: before → rig → ticks (array order) → after → postFx', () => {
    const calls: string[] = [];
    const components = [makeComponent('a', calls), makeComponent('b', calls)];
    const stop = startFrameLoop(components, makeCtx(), {
      rig: { update: () => calls.push('rig'), camera: CAMERA },
      postFx: { render: () => calls.push('render') },
      before: () => calls.push('before'),
      after: () => calls.push('after'),
    });

    // First frame already ran synchronously (no rAF flush needed).
    expect(calls).toEqual(['before', 'rig', 'a', 'b', 'after', 'render']);
    stop();
  });

  it('skips a missing tick() and the optional before/after hooks', () => {
    const calls: string[] = [];
    const tickless: SceneComponent = { group: new THREE.Group(), dispose: () => {} };
    const stop = startFrameLoop([tickless, makeComponent('a', calls)], makeCtx(), {
      rig: { update: () => calls.push('rig'), camera: CAMERA },
      postFx: { render: () => calls.push('render') },
    });
    expect(calls).toEqual(['rig', 'a', 'render']);
    stop();
  });

  it('passes dt = 0 on the first frame and a non-negative dt afterwards', () => {
    const dts: number[] = [];
    const component: SceneComponent = {
      group: new THREE.Group(),
      tick: (dt) => dts.push(dt),
      dispose: () => {},
    };
    const stop = startFrameLoop([component], makeCtx(), {
      rig: { update: () => {}, camera: CAMERA },
      postFx: { render: () => {} },
    });

    expect(dts).toEqual([0]);
    flushFrame();
    flushFrame();
    expect(dts).toHaveLength(3);
    expect(dts[1]).toBeGreaterThanOrEqual(0);
    expect(dts[2]).toBeGreaterThanOrEqual(0);
    stop();
  });

  it('builds the FrameContext from the rig camera with time in seconds', () => {
    const frames: FrameContext[] = [];
    const component: SceneComponent = {
      group: new THREE.Group(),
      tick: (_dt, frame) => frames.push(frame),
      dispose: () => {},
    };
    const stop = startFrameLoop([component], makeCtx(), {
      rig: { update: () => {}, camera: CAMERA },
      postFx: { render: () => {} },
    });
    expect(frames[0].camera).toBe(CAMERA);
    expect(frames[0].time).toBeGreaterThanOrEqual(0);
    expect(frames[0].dt).toBe(0);
    stop();
  });

  it('stop() cancels the pending rAF and halts the loop', () => {
    let ticks = 0;
    const component: SceneComponent = {
      group: new THREE.Group(),
      tick: () => ticks++,
      dispose: () => {},
    };
    const stop = startFrameLoop([component], makeCtx(), {
      rig: { update: () => {}, camera: CAMERA },
      postFx: { render: () => {} },
    });
    expect(ticks).toBe(1);
    expect(_rafCallbacks.size).toBe(1);

    stop();
    // The pending rAF was cancelled...
    expect(_rafCallbacks.size).toBe(0);
    // ...and even a stray stale callback would bail on the running flag.
    flushFrame();
    expect(ticks).toBe(1);
  });

  it('re-arms exactly one rAF per frame', () => {
    const stop = startFrameLoop([], makeCtx(), {
      rig: { update: () => {}, camera: CAMERA },
      postFx: { render: () => {} },
    });
    expect(_rafCallbacks.size).toBe(1);
    flushFrame();
    expect(_rafCallbacks.size).toBe(1);
    stop();
    expect(_rafCallbacks.size).toBe(0);
  });
});

// A component throwing used to end rendering for the life of the page: the
// re-arm was the LAST statement of frame(), so the throw skipped it. One bad
// property access in facadePanels read as an empty world with a single console
// line, which is the failure these guard.
describe('a component that throws', () => {
  let errors: string[];

  beforeEach(() => {
    _rafCallbacks = new Map();
    _nextRafId = 1;
    errors = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
      const id = _nextRafId++;
      _rafCallbacks.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
      _rafCallbacks.delete(id);
    });
    vi.spyOn(console, 'error').mockImplementation((msg: unknown) => void errors.push(String(msg)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A loop whose only component throws on the frames `throwOn` names. */
  function loopThrowingOn(throwOn: (frame: number) => boolean) {
    let ticks = 0;
    const renders: string[] = [];
    const component: SceneComponent = {
      group: new THREE.Group(),
      dispose: () => {},
      tick: () => {
        if (throwOn(++ticks)) throw new Error(`frame ${ticks}`);
      },
    };
    const stop = startFrameLoop([component], makeCtx(), {
      rig: { update: () => {}, camera: CAMERA },
      postFx: { render: () => renders.push('render') },
    });
    return { stop, renders, ticks: () => ticks };
  }

  it('draws the frames after it', () => {
    const loop = loopThrowingOn((n) => n === 1);

    // The throwing frame still re-armed, so there is a next one to flush.
    expect(_rafCallbacks.size).toBe(1);
    flushFrame();
    flushFrame();

    expect(loop.ticks()).toBe(3);
    // Frame 1 threw before postFx; 2 and 3 completed.
    expect(loop.renders).toEqual(['render', 'render']);
    loop.stop();
  });

  it('reports every failure rather than swallowing it', () => {
    const loop = loopThrowingOn((n) => n <= 2);
    flushFrame();

    expect(errors.filter((e) => e.includes('frame failed'))).toHaveLength(2);
    loop.stop();
  });

  it('gives up rather than re-entering a broken build at 60fps forever', () => {
    const loop = loopThrowingOn(() => true);
    // Well past the limit: the loop has to stop arming itself, not just log.
    for (let i = 0; i < 40; i++) flushFrame();

    expect(loop.ticks()).toBe(10);
    expect(_rafCallbacks.size).toBe(0);
    expect(errors.some((e) => e.includes('stopping the loop'))).toBe(true);
    loop.stop();
  });
});
