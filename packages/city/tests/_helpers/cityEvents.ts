// A city's event emitter for a test, plus a recorder for the ones a test is
// actually about. Nothing here reaches a store: an event is a statement the
// city makes, and what a consumer does with it is the consumer's test.

import { createCityStatus } from '../../src/status';
import { createEmitter, type CityEmitter, type CityEventName } from '../../src/events';

export { createEmitter };

export interface RecordedEvent {
  name: CityEventName;
  payload: unknown;
}

/** An emitter that keeps what it was told, in order. */
export function recordingEmitter(): { events: CityEmitter; recorded: RecordedEvent[] } {
  const events = createEmitter();
  const recorded: RecordedEvent[] = [];
  const names: CityEventName[] = [
    'build:start',
    'build:stage',
    'build:progress',
    'build:done',
    'build:error',
    'hover',
    'select',
  ];
  for (const name of names) {
    events.on(name, (payload) => void recorded.push({ name, payload }));
  }
  return { events, recorded };
}

/** Resolves the next time this city reports it is on screen. Subscribe BEFORE
 *  the apply: build:done fires two frames after applyManifest resolves, which
 *  is the whole point of it being an event and not a return value. */
export function nextBuild(handle: { on: CityEmitter['on'] }): Promise<void> {
  return new Promise((resolve) => {
    const off = handle.on('build:done', () => {
      off();
      resolve();
    });
  });
}

/** An emitter plus the status folded from it, in the shape a host subscribes
 *  to — `{ status, onStatus }`. What a consumer testing its own readout needs:
 *  drive the events, and the status answers as a real city's would. */
export function statusFrom(events: ReturnType<typeof createEmitter>) {
  const tracker = createCityStatus(events.on);
  return {
    get status() {
      return tracker.value;
    },
    onStatus: tracker.on,
    dispose: tracker.dispose,
  };
}
