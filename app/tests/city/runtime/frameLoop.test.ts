// frameLoop.test.ts — verifies the generic requestAnimationFrame driver
// (city/runtime/frameLoop.ts, unwired until Task 15): per-frame call order
// (before → rig.update → component ticks in array order → after →
// postFx.render), the synchronous first frame with dt = 0, and stop()
// cancelling the pending rAF. requestAnimationFrame/cancelAnimationFrame
// are mocked for determinism (no real frame scheduling).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';

import { startFrameLoop } from '@/city/runtime/frameLoop';
import type { Picker } from '@/city/runtime/picker';
import type { FrameContext, SceneComponent, SceneContext } from '@/city/types';

// Deterministic rAF: collect callbacks; the test flushes them manually.
let _rafCallbacks: Map<number, FrameRequestCallback>;
let _nextRafId: number;

function flushFrame(): void {
  const pending = [..._rafCallbacks.values()];
  _rafCallbacks.clear();
  for (const cb of pending) cb(performance.now());
}

function makeCtx(): SceneContext {
  return {
    scene: new THREE.Scene(),
    picker: null as unknown as Picker,
    camera: new THREE.PerspectiveCamera(),
    renderer: null as unknown as THREE.WebGLRenderer,
  } as SceneContext;
}

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
      rig: { update: () => calls.push('rig') },
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
      rig: { update: () => calls.push('rig') },
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
      rig: { update: () => {} },
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

  it('builds the FrameContext from the SceneContext camera with time in seconds', () => {
    const ctx = makeCtx();
    const frames: FrameContext[] = [];
    const component: SceneComponent = {
      group: new THREE.Group(),
      tick: (_dt, frame) => frames.push(frame),
      dispose: () => {},
    };
    const stop = startFrameLoop([component], ctx, {
      rig: { update: () => {} },
      postFx: { render: () => {} },
    });
    expect(frames[0].camera).toBe(ctx.camera);
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
      rig: { update: () => {} },
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
      rig: { update: () => {} },
      postFx: { render: () => {} },
    });
    expect(_rafCallbacks.size).toBe(1);
    flushFrame();
    expect(_rafCallbacks.size).toBe(1);
    stop();
    expect(_rafCallbacks.size).toBe(0);
  });
});
