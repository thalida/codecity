// app/tests/city/components/armOnFirstTick.test.ts
//
// Tests for armOnFirstTick(ctx, setup, opts) — the shared "arm picker-dependent
// work on the first tick" lifecycle extracted from buildings/streets/fireflies/
// trees/pathLine. Components are constructed before ctx.picker/.renderer exist;
// the helper defers setup() to the first arm() after those are live, runs it
// exactly ONCE (sticky), and survives dispose() so a stray post-dispose arm()
// cannot re-arm.
//
// The fake SceneContext carries mutable picker/renderer so a test can flip them
// from null (construction window) to live (createCity populated them) and assert
// the guard fires at exactly the right moment.

import { describe, it, expect, vi } from 'vitest';

import { armOnFirstTick } from '@/city/utils/armOnFirstTick';
import type { SceneContext } from '@/city/types';
import type { Picker } from '@/city/render/picker';
import type * as THREE from 'three';

// Mutable fake: picker/renderer start null (the construction window) and are
// flipped live to simulate createCity populating ctx before the first tick.
function makeCtx(): SceneContext {
  return {
    scene: {} as THREE.Scene,
    picker: null as unknown as Picker,
    camera: {} as THREE.PerspectiveCamera,
    renderer: null as unknown as THREE.WebGLRenderer,
  } as SceneContext;
}

const livePicker = {} as unknown as Picker;
const liveRenderer = {} as unknown as THREE.WebGLRenderer;

describe('armOnFirstTick', () => {
  it('arms once after picker becomes live (setup runs exactly once across many arm() calls)', () => {
    const ctx = makeCtx();
    const setup = vi.fn(() => [] as Array<() => void>);
    const arm = armOnFirstTick(ctx, setup);

    // Construction window: picker null → no-op.
    arm.arm();
    expect(setup).not.toHaveBeenCalled();

    // createCity populates the picker; the first arm() now runs setup.
    ctx.picker = livePicker;
    arm.arm();
    expect(setup).toHaveBeenCalledTimes(1);

    // Subsequent ticks are no-ops (sticky once).
    arm.arm();
    arm.arm();
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it('does NOT arm while picker is null', () => {
    const ctx = makeCtx();
    const setup = vi.fn(() => [] as Array<() => void>);
    const arm = armOnFirstTick(ctx, setup);

    arm.arm();
    arm.arm();
    expect(setup).not.toHaveBeenCalled();
  });

  it('with needsRenderer: does NOT arm while renderer is null even if picker is live', () => {
    const ctx = makeCtx();
    const setup = vi.fn(() => [] as Array<() => void>);
    const arm = armOnFirstTick(ctx, setup, { needsRenderer: true });

    ctx.picker = livePicker;
    arm.arm();
    expect(setup).not.toHaveBeenCalled();

    // Both live → arms.
    ctx.renderer = liveRenderer;
    arm.arm();
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it('without needsRenderer: arms on a live picker regardless of renderer', () => {
    const ctx = makeCtx();
    const setup = vi.fn(() => [] as Array<() => void>);
    const arm = armOnFirstTick(ctx, setup);

    ctx.picker = livePicker;
    // renderer still null — picker-only components don't care.
    arm.arm();
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it('runs the setup teardowns on dispose', () => {
    const ctx = makeCtx();
    const t1 = vi.fn();
    const t2 = vi.fn();
    const arm = armOnFirstTick(ctx, () => [t1, t2]);

    ctx.picker = livePicker;
    arm.arm();
    arm.dispose();
    expect(t1).toHaveBeenCalledTimes(1);
    expect(t2).toHaveBeenCalledTimes(1);
  });

  it('post-dispose arm() is a no-op (never re-arms)', () => {
    const ctx = makeCtx();
    const setup = vi.fn(() => [] as Array<() => void>);
    const arm = armOnFirstTick(ctx, setup);

    ctx.picker = livePicker;
    arm.arm();
    expect(setup).toHaveBeenCalledTimes(1);

    arm.dispose();
    // Stray post-dispose tick — armed stays true, so setup is NOT re-run.
    arm.arm();
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it('dispose before arm() is safe (no teardowns to run)', () => {
    const ctx = makeCtx();
    const setup = vi.fn(() => [vi.fn()]);
    const arm = armOnFirstTick(ctx, setup);

    expect(() => arm.dispose()).not.toThrow();
    expect(setup).not.toHaveBeenCalled();
  });

  it('dispose is idempotent — teardowns run at most once across repeated calls', () => {
    const ctx = makeCtx();
    const t1 = vi.fn();
    const arm = armOnFirstTick(ctx, () => [t1]);

    ctx.picker = livePicker;
    arm.arm();
    arm.dispose();
    arm.dispose();
    expect(t1).toHaveBeenCalledTimes(1);
  });
});
