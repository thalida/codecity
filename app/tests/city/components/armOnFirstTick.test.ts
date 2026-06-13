// app/tests/city/components/armOnFirstTick.test.ts
//
// Tests for armOnFirstTick(ctx, setup) — the shared "arm picker-dependent work
// on the first tick" lifecycle extracted from buildings/streets/fireflies/
// trees/pathLine. Components are constructed before ctx.picker exists; the
// helper defers setup() to the first arm() after the picker is live, runs it
// exactly ONCE (sticky), and survives dispose() so a stray post-dispose arm()
// cannot re-arm.
//
// The fake SceneContext carries a mutable picker so a test can flip it from null
// (construction window) to live (createCity backfilled it) and assert the guard
// fires at exactly the right moment.

import { describe, it, expect, vi } from 'vitest';

import { armOnFirstTick } from '@/city/utils/armOnFirstTick';
import type { SceneContext } from '@/city/types';
import type { Picker } from '@/city/interaction/picker';

// Mutable fake: picker starts null (the construction window) and is flipped live
// to simulate createCity backfilling ctx before the first tick. The helper reads
// only ctx.picker, so nothing else is needed.
function makeCtx(): SceneContext {
  return { picker: null as unknown as Picker } as unknown as SceneContext;
}

const livePicker = {} as unknown as Picker;

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
