// app/tests/city/components/onSettings.test.ts
//
// onSettings(store, apply) is the shared theme-reactivity wrapper for the
// city components. It must:
//   - run `apply` once synchronously at wire time,
//   - re-run `apply` on every Save (write) of `store`,
//   - NOT re-run when some OTHER signal that `apply` reads changes (apply runs
//     untracked, so reads inside it never become dependencies),
//   - return a stop fn that unsubscribes.
import { describe, it, expect } from 'vitest';
import { signal } from '@preact/signals';
import { onSettings } from '@/city/utils/onSettings';

describe('onSettings', () => {
  it('runs apply once immediately at wire time', () => {
    const store = signal({ a: 1 });
    let runs = 0;
    const stop = onSettings(store, () => {
      runs++;
    });
    expect(runs).toBe(1);
    stop();
  });

  it('re-runs apply on every Save of the store', () => {
    const store = signal({ a: 1 });
    let runs = 0;
    const stop = onSettings(store, () => {
      runs++;
    });
    expect(runs).toBe(1);

    store.value = { a: 2 };
    expect(runs).toBe(2);

    store.value = { a: 3 };
    expect(runs).toBe(3);
    stop();
  });

  it('reads the fresh store value inside apply on each run', () => {
    const store = signal({ a: 1 });
    const seen: number[] = [];
    const stop = onSettings(store, () => {
      seen.push(store.value.a);
    });
    store.value = { a: 7 };
    store.value = { a: 9 };
    expect(seen).toEqual([1, 7, 9]);
    stop();
  });

  it('does NOT re-run when an untracked-read signal changes', () => {
    const store = signal({ a: 1 });
    const other = signal(0);
    let runs = 0;
    const stop = onSettings(store, () => {
      // apply reads `other` — but because onSettings invokes apply untracked,
      // `other` must NOT become a dependency.
      void other.value;
      runs++;
    });
    expect(runs).toBe(1);

    other.value = 1;
    other.value = 2;
    expect(runs).toBe(1); // unchanged — other is not tracked

    store.value = { a: 2 };
    expect(runs).toBe(2); // only the store re-fires
    stop();
  });

  it('stop() unsubscribes — no further runs on Save', () => {
    const store = signal({ a: 1 });
    let runs = 0;
    const stop = onSettings(store, () => {
      runs++;
    });
    expect(runs).toBe(1);

    stop();
    store.value = { a: 2 };
    store.value = { a: 3 };
    expect(runs).toBe(1);
  });
});
