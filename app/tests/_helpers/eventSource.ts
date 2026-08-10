// EventSource stub for the SSE streams (manifest, timeline). Records its
// listeners so a test can emit a named server event, and records every
// instance so a test can assert on the URL that was opened or that the stream
// was closed on abort.

export class StubEventSource {
  static instances: StubEventSource[] = [];
  closed = false;
  private listeners: Record<string, ((e: unknown) => void)[]> = {};

  constructor(public url: string) {
    StubEventSource.instances.push(this);
  }

  addEventListener(name: string, handler: (e: unknown) => void): void {
    (this.listeners[name] ??= []).push(handler);
  }

  close(): void {
    this.closed = true;
  }

  /** Dispatch a named event carrying JSON data or, with `data` omitted, a
   *  transport-level error (a bare event with no data). */
  emit(name: string, data?: string): void {
    const e = data === undefined ? {} : { data };
    for (const h of this.listeners[name] ?? []) h(e);
  }
}

/** For the api/ layer, which takes an EventSource ctor as a parameter. */
export function makeES(): { ctor: typeof EventSource; last: () => StubEventSource } {
  StubEventSource.instances = [];
  const ctor = function (url: string): StubEventSource {
    return new StubEventSource(url);
  } as unknown as typeof EventSource;
  return {
    ctor,
    last: () => StubEventSource.instances[StubEventSource.instances.length - 1],
  };
}

/** For the hooks layer, which reads EventSource off globalThis. Returns the
 *  restore function for afterEach. */
export function installEventSource(): () => void {
  const original = globalThis.EventSource;
  StubEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = StubEventSource;
  return () => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = original;
  };
}
