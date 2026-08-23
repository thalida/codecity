// Per-frame call order and the rAF contract: exactly one frame queued at a
// time, and stop() cancels the pending one.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';

import { startFrameLoop } from '@/city/scene/render/frameLoop';
import type { FrameContext, SceneComponent, SceneContext } from '@/city/scene/types';

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
