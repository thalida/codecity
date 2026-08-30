// features/city/state/readout.ts — what the chrome says ABOUT the city: work
// this app is doing that no city reports, and when the last build landed.

import { type CityStatus, CityLifecycle } from '@codecity/city';
import { signal } from '@preact/signals';

// Two facts the city has no event for, because neither is about the city: a

/** Work THIS app is doing that no city is reporting, and failures of it. Three
 *  cases, all genuinely the host's: a Save the city answers by refreshing */
export interface HostWork {
  busy: boolean;
  error: unknown | null;
}

export const HOST_WORK = signal<HostWork>({ busy: false, error: null });

export function beginHostWork(): void {
  HOST_WORK.value = { busy: true, error: null };
}

export function endHostWork(): void {
  if (!HOST_WORK.peek().busy) return;
  HOST_WORK.value = { busy: false, error: null };
  LAST_UPDATED_AT.value = Date.now();
}

export function failHostWork(error: unknown): void {
  // Logged with the stack, where a developer can use it. The UI shows a generic
  // line: the message names our internals, and a reader cannot act on it.
  console.error('[codecity] the app could not finish what it started', error);
  HOST_WORK.value = { busy: false, error };
  REBUILD_DETAIL.value = null;
}

/** Epoch millis of the most recent finished build. The city says it is Ready;
 *  how long ago that was is the reader's question, not the city's. */
export const LAST_UPDATED_AT = signal<number>(0);

/** How far along a rebuild that has no overlay above it (Timeline refetching a
 *  bundle under an exclude edit) — the one build nothing else reports. */
export const REBUILD_DETAIL = signal<string | null>(null);

export function setRebuildDetail(detail: string | null): void {
  REBUILD_DETAIL.value = detail;
}

/** Keep the app's own two facts in step with one city's status: what the
 *  finished city was built from, and when it finished. The SCENE city's only — */
export function createBuildReport(initial: CityStatus): (status: CityStatus) => void {
  let wasReady = initial.lifecycle === CityLifecycle.Ready;
  return (status: CityStatus) => {
    const ready = status.lifecycle === CityLifecycle.Ready;
    if (ready && !wasReady) {
      LAST_UPDATED_AT.value = Date.now();
      REBUILD_DETAIL.value = null;
    }
    wasReady = ready;
    if (status.lifecycle === CityLifecycle.Error) {
      // Logged with the stack, where a developer can use it. The UI shows a
      // generic line: the message names our internals, and a reader cannot act
      console.error('[codecity] city build failed', status.error);
      REBUILD_DETAIL.value = null;
    }
  };
}
