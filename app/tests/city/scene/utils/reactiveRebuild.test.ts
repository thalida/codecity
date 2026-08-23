import { describe, it, expect, vi } from 'vitest';
import { signal } from '@preact/signals';
import { reactiveRebuild } from '@/city/scene/utils/reactiveRebuild';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('reactiveRebuild', () => {
  it('does not run a queued rebuild after dispose', async () => {
    // Creating the handle runs the effect once and queues a run() microtask.
    const dep = signal(1);
    const run = vi.fn(async () => {});
    const onError = vi.fn();

    const handle = reactiveRebuild(() => dep.value, run, onError);
    handle.dispose(); // dispose before the queued microtask flushes
    await tick();

    expect(run).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('bails an in-flight rebuild after dispose instead of throwing past it', async () => {
    const dep = signal(1);
    let reachedAfterAwait = false;
    const run = vi.fn(async (_snap: number, isCurrent: () => boolean) => {
      await Promise.resolve();
      if (!isCurrent()) return;
      reachedAfterAwait = true;
      throw new Error('touched a torn-down scene');
    });
    const onError = vi.fn();

    const handle = reactiveRebuild(() => dep.value, run, onError);
    await Promise.resolve(); // let run() start and suspend at its await
    handle.dispose();
    await tick();

    expect(reachedAfterAwait).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });
});
