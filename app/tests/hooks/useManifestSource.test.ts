import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadSource,
  cancelLoad,
  setupLiveUpdates,
  refreshCurrentSource,
  setTimelineRefreshHandler,
} from '@/hooks/useManifestSource';
import { SOURCE_ERROR, CURRENT_SOURCE, RECENTS } from '@/state/stores/source';
import { MANIFEST } from '@/state/stores/manifest';
import { EXCLUDES, addExclude } from '@/state/stores/excludes';
import { TIMELINE_MODE, SCRUB_POS, TIMELINE_BUNDLE, setScrubPos } from '@/state/stores/timeline';
import type { TimelineBundle } from '@/types';
import { PENDING_SOURCE_LABEL } from '@/state/stores/ui';
import { StubEventSource, installEventSource } from '../_helpers/eventSource';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('useManifestSource loadSource cancellation', () => {
  let restoreEventSource: () => void;

  beforeEach(() => {
    restoreEventSource = installEventSource();
    SOURCE_ERROR.value = null;
  });

  afterEach(() => {
    restoreEventSource();
  });

  describe('loading header label', () => {
    it('is up before the server sends one, seeded from recents', async () => {
      RECENTS.value = [
        { src: 'https://github.com/o/r', label: 'o/r', lastOpenedAt: 1 },
      ] as typeof RECENTS.value;
      PENDING_SOURCE_LABEL.value = null;

      const p = loadSource({ src: 'https://github.com/o/r' });
      // No event has arrived yet: the overlay is already on screen.
      expect(PENDING_SOURCE_LABEL.value, 'header must not be blank while resolving').toBe('o/r');

      cancelLoad();
      await p;
    });

    it('survives the stream ending, since the city is still being built', async () => {
      RECENTS.value = [];
      const p = loadSource({ src: 'https://github.com/o/r' });
      StubEventSource.instances[0]!.emit(
        'manifest-complete',
        JSON.stringify({ manifest: { tree: { name: 'o/r' } } })
      );
      await p;

      // loadSource is done; the overlay lives on through Building/Decorating,
      // and the header has to live exactly as long as the overlay.
      expect(PENDING_SOURCE_LABEL.value, 'cleared with the stream, not the overlay').toBe('o/r');
    });
  });

  it('canceling a load leaves SOURCE_ERROR null and CURRENT_SOURCE unchanged', async () => {
    const before = CURRENT_SOURCE.value;

    const p = loadSource({ src: 'https://github.com/o/r' }); // starts the load
    cancelLoad(); // aborts via loadController before any event arrives

    await p;

    expect(SOURCE_ERROR.value).toBeNull();
    expect(CURRENT_SOURCE.value).toBe(before);
    expect(StubEventSource.instances[0]?.closed).toBe(true);
  });

  it('canceling AFTER a skeleton manifest does not commit it as CURRENT_SOURCE', async () => {
    const before = CURRENT_SOURCE.value;

    const p = loadSource({ src: 'https://github.com/o/r' });
    await flush(); // let the for-await attach its event listeners

    // An aborted stream ends done, not a throw, so the success path receives
    // the skeleton and still has to refuse to commit it.
    StubEventSource.instances[0]!.emit(
      'manifest-partial',
      JSON.stringify({
        manifest: { root: '/r', tree: { type: 'directory' }, content_signature: 'sig' },
      })
    );
    await flush();
    cancelLoad();

    await p;

    expect(CURRENT_SOURCE.value).toBe(before); // NOT committed
    expect(SOURCE_ERROR.value).toBeNull(); // cancel is not an error
    expect(StubEventSource.instances[0]?.closed).toBe(true);
  });

  it('canceling AFTER a skeleton rolls MANIFEST back to the prior city', async () => {
    // City A is already applied (source unchanged throughout this load of B).
    const cityA = { root: '/a', tree: { type: 'directory' }, content_signature: 'sig-a' };
    MANIFEST.value = cityA;
    const before = CURRENT_SOURCE.value;

    const p = loadSource({ src: 'https://github.com/o/b' });
    await flush(); // let the for-await attach its event listeners

    // B's skeleton streams into MANIFEST (behind the overlay)...
    StubEventSource.instances[0]!.emit(
      'manifest-partial',
      JSON.stringify({
        manifest: { root: '/b', tree: { type: 'directory' }, content_signature: 'sig-b' },
      })
    );
    await flush();
    expect(MANIFEST.value).not.toBe(cityA); // sanity: B's skeleton IS applied mid-load

    cancelLoad(); // ...then the user cancels before B's final arrives
    await p;

    expect(MANIFEST.value).toBe(cityA); // rolled back to city A
    expect(CURRENT_SOURCE.value).toBe(before); // never committed B
    expect(SOURCE_ERROR.value).toBeNull(); // cancel is not an error
  });
});

// #113: a switch in Timeline left the union city stuck on the new repo.
// loadSource exits the mode; the city layer reacts to the flip and tears down.
describe('loadSource exits Timeline mode', () => {
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    StubEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = StubEventSource;
    SOURCE_ERROR.value = null;
  });

  afterEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalEventSource;
    TIMELINE_MODE.value = false;
    setScrubPos(0);
    TIMELINE_BUNDLE.value = null;
  });

  it('flips TIMELINE_MODE off and clears the scrub store before the fetch starts', async () => {
    TIMELINE_MODE.value = true;
    setScrubPos(3);
    TIMELINE_BUNDLE.value = { commits: [{ sha: 'a' }] } as unknown as TimelineBundle;

    const p = loadSource({ src: 'https://github.com/o/r' });

    expect(TIMELINE_MODE.value).toBe(false);
    expect(SCRUB_POS.value).toBe(0);
    expect(TIMELINE_BUNDLE.value).toBeNull();

    cancelLoad();
    await p;
  });

  it('a normal switch when NOT in Timeline mode leaves it untouched', async () => {
    TIMELINE_MODE.value = false;

    const p = loadSource({ src: 'https://github.com/o/r' });

    expect(TIMELINE_MODE.value).toBe(false);

    cancelLoad();
    await p;
  });
});

// The header's Refresh re-reads whatever you are looking at. In Timeline that
// is the history bundle: a live re-scan would answer it by leaving the mode.
describe('refreshCurrentSource', () => {
  let restoreEventSource: () => void;
  let timelineRefreshes: Array<{ noCache?: boolean } | undefined>;

  beforeEach(() => {
    restoreEventSource = installEventSource();
    timelineRefreshes = [];
    setTimelineRefreshHandler((opts) => {
      timelineRefreshes.push(opts);
      return Promise.resolve();
    });
    CURRENT_SOURCE.value = { src: 'https://github.com/o/r' };
    SOURCE_ERROR.value = null;
  });

  afterEach(() => {
    restoreEventSource();
    setTimelineRefreshHandler(null);
    TIMELINE_MODE.value = false;
    CURRENT_SOURCE.value = null;
  });

  it('re-reads the history bundle in place, staying in Timeline', () => {
    TIMELINE_MODE.value = true;

    refreshCurrentSource(false);

    expect(timelineRefreshes).toEqual([{ noCache: false }]);
    expect(TIMELINE_MODE.value).toBe(true);
    expect(StubEventSource.instances.length, 'no live re-scan').toBe(0);
  });

  it('re-scans live when that is the mode', async () => {
    TIMELINE_MODE.value = false;

    refreshCurrentSource(false);
    await flush();

    expect(timelineRefreshes).toEqual([]);
    expect(StubEventSource.instances.length).toBe(1);

    cancelLoad();
  });

  // Fresh scan is "ignore the cache", not "leave Timeline": the bundle caches
  // per HEAD like the live scan does, so the flag rides the history read.
  it('carries a fresh scan into the history read, staying in Timeline', () => {
    TIMELINE_MODE.value = true;

    refreshCurrentSource(true);

    expect(timelineRefreshes).toEqual([{ noCache: true }]);
    expect(TIMELINE_MODE.value).toBe(true);
    expect(StubEventSource.instances.length, 'no live re-scan').toBe(0);
  });

  it('sends no_cache on a live fresh scan', async () => {
    TIMELINE_MODE.value = false;

    refreshCurrentSource(true);
    await flush();

    expect(StubEventSource.instances[0]!.url).toContain('no_cache=true');

    cancelLoad();
  });

  it('does nothing with no source open', () => {
    CURRENT_SOURCE.value = null;

    refreshCurrentSource(false);

    expect(timelineRefreshes).toEqual([]);
    expect(StubEventSource.instances.length).toBe(0);
  });
});

// `manifest-complete` is terminal on the wire: the reader closes the
// EventSource itself, and there is no separate "done" event.
const MANIFEST_JSON = JSON.stringify({
  manifest: {
    content_signature: 'sig0',
    structure_signature: 't0',
    layout_signature: 't0',
    tree: { name: 'r', type: 'directory', path: '.', children: [] },
    repo: {},
  },
});

describe('exclude-driven re-fetch', () => {
  let restoreEventSource: () => void;
  beforeEach(() => {
    restoreEventSource = installEventSource();
    EXCLUDES.value = {};
    CURRENT_SOURCE.value = null;
    MANIFEST.value = { tree: {} } as never;
  });
  afterEach(() => {
    restoreEventSource();
  });

  it('re-fetches the loaded source with the exclude param when an exclude is added', async () => {
    const load = loadSource({ src: 's', branch: undefined });
    await flush();
    StubEventSource.instances[0].emit('manifest-complete', MANIFEST_JSON);
    await load;
    expect(CURRENT_SOURCE.value?.src).toBe('s');

    const dispose = setupLiveUpdates();
    const before = StubEventSource.instances.length;
    addExclude('vendor');
    await flush();
    const fresh = StubEventSource.instances.slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    expect(new URL(fresh[0].url).searchParams.getAll('exclude')).toEqual(['vendor']);
    dispose();
  });

  it('does not re-fetch merely because the source switched', async () => {
    // Without a first load the reaction exits on `prev === null` and the
    // switch guard it is here to exercise never runs.
    const load = loadSource({ src: 's1', branch: undefined });
    await flush();
    StubEventSource.instances[0].emit('manifest-complete', MANIFEST_JSON);
    await load;
    expect(CURRENT_SOURCE.value?.src).toBe('s1');

    const dispose = setupLiveUpdates();
    const before = StubEventSource.instances.length;
    CURRENT_SOURCE.value = { src: 's2', branch: undefined }; // real repo-key change, no exclude edit
    await flush();
    // The switch alone must NOT refetch — the load owns sending s2's excludes.
    expect(StubEventSource.instances.length).toBe(before);
    dispose();
  });
});
