import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { readUrlView } from '@/router/viewParams';
import { RECENTS, EXCLUDES } from '@/state/stores/source';
import type { TimelineBundle } from '@/types';
import { StubEventSource, installEventSource } from '../../_helpers/eventSource';
import { flush } from '../../_helpers/preact';
import { navigate, ROUTE_PARAMS } from '@/router/location';
import { ROUTES } from '@/router/paths';
import { makeSession } from '../../_helpers/city';
import { attachUrlBinding } from '@/router/urlBinding';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

describe('CityLoader loadSource cancellation', () => {
  let restoreEventSource: () => void;

  beforeEach(() => {
    restoreEventSource = installEventSource();
    session.source.error.value = null;
  });

  afterEach(() => {
    restoreEventSource();
  });

  describe('loading header label', () => {
    it('is up before the server sends one, seeded from recents', async () => {
      RECENTS.value = [
        { src: 'https://github.com/o/r', label: 'o/r', lastOpenedAt: 1 },
      ] as typeof RECENTS.value;
      session.progress.pendingLabel.value = null;

      const p = session.load.loadSource({ src: 'https://github.com/o/r' });
      // No event has arrived yet: the overlay is already on screen.
      expect(session.progress.pendingLabel.value, 'header must not be blank while resolving').toBe(
        'o/r'
      );

      session.load.cancel();
      await p;
    });

    it('survives the stream ending, since the city is still being built', async () => {
      RECENTS.value = [];
      const p = session.load.loadSource({ src: 'https://github.com/o/r' });
      StubEventSource.instances[0]!.emit(
        'manifest-complete',
        JSON.stringify({ manifest: { tree: { name: 'o/r' } } })
      );
      await p;

      // loadSource is done; the overlay lives on through Building, and the
      // header has to live exactly as long as the overlay.
      expect(session.progress.pendingLabel.value, 'cleared with the stream, not the overlay').toBe(
        'o/r'
      );
    });
  });

  it('a new attempt retires the last failure, so it cannot outlive what explained it', async () => {
    session.source.error.value = {
      error: 'repository not found',
      prefill: { src: 'https://github.com/o/gone' },
    };

    const p = session.load.loadSource({ src: 'https://github.com/o/r' });
    expect(
      session.source.error.value,
      'cleared as the attempt starts, not when it lands'
    ).toBeNull();

    session.load.cancel();
    await p;
  });

  it('canceling a load leaves SOURCE_ERROR null and CURRENT_SOURCE unchanged', async () => {
    const before = session.source.current.value;

    const p = session.load.loadSource({ src: 'https://github.com/o/r' }); // starts the load
    session.load.cancel(); // aborts via loadController before any event arrives

    await p;

    expect(session.source.error.value).toBeNull();
    expect(session.source.current.value).toBe(before);
    expect(StubEventSource.instances[0]?.closed).toBe(true);
  });

  it('canceling AFTER a skeleton manifest does not commit it as CURRENT_SOURCE', async () => {
    const before = session.source.current.value;

    const p = session.load.loadSource({ src: 'https://github.com/o/r' });
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
    session.load.cancel();

    await p;

    expect(session.source.current.value).toBe(before); // NOT committed
    expect(session.source.error.value).toBeNull(); // cancel is not an error
    expect(StubEventSource.instances[0]?.closed).toBe(true);
  });

  it('canceling AFTER a skeleton rolls MANIFEST back to the prior city', async () => {
    // City A is already applied (source unchanged throughout this load of B).
    const cityA = { root: '/a', tree: { type: 'directory' }, content_signature: 'sig-a' };
    session.manifest.current.value = cityA;
    const before = session.source.current.value;

    const p = session.load.loadSource({ src: 'https://github.com/o/b' });
    await flush(); // let the for-await attach its event listeners

    // B's skeleton streams into MANIFEST (behind the overlay)...
    StubEventSource.instances[0]!.emit(
      'manifest-partial',
      JSON.stringify({
        manifest: { root: '/b', tree: { type: 'directory' }, content_signature: 'sig-b' },
      })
    );
    await flush();
    expect(session.manifest.current.value).not.toBe(cityA); // sanity: B's skeleton IS applied mid-load

    session.load.cancel(); // ...then the user cancels before B's final arrives
    await p;

    expect(session.manifest.current.value).toBe(cityA); // rolled back to city A
    expect(session.source.current.value).toBe(before); // never committed B
    expect(session.source.error.value).toBeNull(); // cancel is not an error
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
    session.source.error.value = null;
  });

  afterEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalEventSource;
    session.timeline.mode.value = false;
    session.timeline.setScrubPos(0);
    session.timeline.bundle.value = null;
  });

  it('flips TIMELINE_MODE off and clears the scrub store before the fetch starts', async () => {
    session.timeline.mode.value = true;
    session.timeline.setScrubPos(3);
    session.timeline.bundle.value = { commits: [{ sha: 'a' }] } as unknown as TimelineBundle;

    const p = session.load.loadSource({ src: 'https://github.com/o/r' });

    expect(session.timeline.mode.value).toBe(false);
    expect(session.timeline.scrubPos.value).toBe(0);
    expect(session.timeline.bundle.value).toBeNull();

    session.load.cancel();
    await p;
  });

  it('a normal switch when NOT in Timeline mode leaves it untouched', async () => {
    session.timeline.mode.value = false;

    const p = session.load.loadSource({ src: 'https://github.com/o/r' });

    expect(session.timeline.mode.value).toBe(false);

    session.load.cancel();
    await p;
  });
});

// The header's Refresh re-reads whatever you are looking at. In Timeline that
// is the history bundle: a live re-scan would answer it by leaving the mode.
describe('refreshCurrentSource', () => {
  let restoreEventSource: () => void;
  let timelineRefreshes: Array<{ noCache?: boolean; overlay?: boolean } | undefined>;

  beforeEach(() => {
    restoreEventSource = installEventSource();
    timelineRefreshes = [];
    // A refresh in Timeline goes to this session's controller, not to a
    // module-level handler someone injected earlier.
    vi.spyOn(session.timelineMode, 'loadScene').mockImplementation((opts) => {
      timelineRefreshes.push(opts && { noCache: opts.noCache, overlay: opts.overlay });
      return Promise.resolve();
    });
    session.source.current.value = { src: 'https://github.com/o/r' };
    session.source.error.value = null;
  });

  afterEach(() => {
    restoreEventSource();
    session.timeline.mode.value = false;
    session.source.current.value = null;
  });

  it('re-reads the history bundle in place, staying in Timeline', () => {
    session.timeline.mode.value = true;

    session.load.refresh(false);

    // overlay: asked for by hand, so it reports its stages like a Live refresh.
    expect(timelineRefreshes).toEqual([{ noCache: false, overlay: true }]);
    expect(session.timeline.mode.value).toBe(true);
    expect(StubEventSource.instances.length, 'no live re-scan').toBe(0);
  });

  it('re-scans live when that is the mode', async () => {
    session.timeline.mode.value = false;

    session.load.refresh(false);
    await flush();

    expect(timelineRefreshes).toEqual([]);
    expect(StubEventSource.instances.length).toBe(1);

    session.load.cancel();
  });

  // Fresh scan is "ignore the cache", not "leave Timeline": the bundle caches
  // per HEAD like the live scan does, so the flag rides the history read.
  it('carries a fresh scan into the history read, staying in Timeline', () => {
    session.timeline.mode.value = true;

    session.load.refresh(true);

    expect(timelineRefreshes).toEqual([{ noCache: true, overlay: true }]);
    expect(session.timeline.mode.value).toBe(true);
    expect(StubEventSource.instances.length, 'no live re-scan').toBe(0);
  });

  it('sends no_cache on a live fresh scan', async () => {
    session.timeline.mode.value = false;

    session.load.refresh(true);
    await flush();

    expect(StubEventSource.instances[0]!.url).toContain('no_cache=true');

    session.load.cancel();
  });

  it('does nothing with no source open', () => {
    session.source.current.value = null;

    session.load.refresh(false);

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
    session.source.current.value = null;
    session.manifest.current.value = { tree: {} } as never;
  });
  afterEach(() => {
    restoreEventSource();
  });

  it('re-fetches the loaded source with the exclude param when an exclude is added', async () => {
    const load = session.load.loadSource({ src: 's', branch: undefined });
    await flush();
    StubEventSource.instances[0].emit('manifest-complete', MANIFEST_JSON);
    await load;
    expect(session.source.current.value?.src).toBe('s');

    const dispose = session.load.setupLiveUpdates();
    const before = StubEventSource.instances.length;
    session.source.addExclude('vendor');
    await flush();
    const fresh = StubEventSource.instances.slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    expect(new URL(fresh[0].url).searchParams.getAll('exclude')).toEqual(['vendor']);
    dispose();
  });

  it('does not re-fetch merely because the source switched', async () => {
    // Without a first load the reaction exits on `prev === null` and the
    // switch guard it is here to exercise never runs.
    const load = session.load.loadSource({ src: 's1', branch: undefined });
    await flush();
    StubEventSource.instances[0].emit('manifest-complete', MANIFEST_JSON);
    await load;
    expect(session.source.current.value?.src).toBe('s1');

    const dispose = session.load.setupLiveUpdates();
    const before = StubEventSource.instances.length;
    session.source.current.value = { src: 's2', branch: undefined }; // real repo-key change, no exclude edit
    await flush();
    // The switch alone must NOT refetch — the load owns sending s2's excludes.
    expect(StubEventSource.instances.length).toBe(before);
    dispose();
  });
});

// Each mode has its own call and manifest, so the boot picks one: a Timeline
// URL loads the bundle and never scans HEAD for a city it won't show.
describe('the boot load runs the mode the URL asks for', () => {
  let restoreEventSource: () => void;

  beforeEach(() => {
    restoreEventSource = installEventSource();
    StubEventSource.instances = [];
    session.source.error.value = null;
    session.timeline.mode.value = false;
    navigate(ROUTES.HOME, { replace: true });
  });

  afterEach(() => {
    restoreEventSource();
    session.timeline.mode.value = false;
    navigate(ROUTES.HOME, { replace: true });
  });

  const boot = (search: string): Promise<void> => {
    navigate(`/city${search}`, { replace: true });
    return session.load.boot(readUrlView(ROUTE_PARAMS.peek()));
  };

  it('hands a ?mode=timeline boot the bundle load, with no live scan', async () => {
    const loads: unknown[] = [];
    vi.spyOn(session.timelineMode, 'loadSource').mockImplementation((payload) => {
      loads.push(payload);
      session.timeline.mode.value = true;
      return Promise.resolve();
    });

    await boot('?src=%2Frepos%2Fcodecity&mode=timeline&commit=abc123');

    expect(loads).toEqual([{ src: '/repos/codecity', branch: undefined, commit: 'abc123' }]);
    expect(StubEventSource.instances).toHaveLength(0); // nothing scanned HEAD
  });

  it('scans HEAD when the URL names no mode', async () => {
    let timelineLoads = 0;
    vi.spyOn(session.timelineMode, 'loadSource').mockImplementation(() => {
      timelineLoads++;
      return Promise.resolve();
    });

    const p = boot('?src=%2Frepos%2Fcodecity');
    expect(StubEventSource.instances).toHaveLength(1);
    expect(timelineLoads).toBe(0);
    session.load.cancel();
    await p;
  });

  // A history bundle that won't load leaves you on a working city, not an
  // empty one: the other mode still has a city to show.
  it('falls back to a live load when the timeline boot fails to engage', async () => {
    vi.spyOn(session.timelineMode, 'loadSource').mockImplementation(() => {
      /* fetch failed; mode never turned on */
      return Promise.resolve();
    });

    const p = boot('?src=%2Frepos%2Fcodecity&mode=timeline');
    await flush();
    expect(StubEventSource.instances).toHaveLength(1);
    session.load.cancel();
    await p;
  });
});

describe('the URL drives what is loaded', () => {
  let restoreEventSource: () => void;
  let detach: () => void;

  const paramOf = (i: number, name: string): string | null =>
    new URL(StubEventSource.instances[i]!.url, 'http://x').searchParams.get(name);
  const srcOf = (i: number): string | null => paramOf(i, 'src');
  const branchOf = (i: number): string | null => paramOf(i, 'branch');

  /** Finish the in-flight load, which is what commits the source. */
  const complete = async (name: string): Promise<void> => {
    const es = StubEventSource.instances[StubEventSource.instances.length - 1]!;
    // repo included: commitSource reads repo.branch, and without it the load
    // throws — which used to look like success, because a failure kept its claim.
    es.emit(
      'manifest-complete',
      JSON.stringify({ manifest: { tree: { name }, repo: { branch: null } } })
    );
    await flush();
  };

  beforeEach(() => {
    restoreEventSource = installEventSource();
    StubEventSource.instances = [];
    session.source.current.value = null;
    session.source.error.value = null;
    navigate(ROUTES.HOME, { replace: true });
  });

  afterEach(() => {
    detach?.();
    restoreEventSource();
    session.source.current.value = null;
    navigate(ROUTES.HOME, { replace: true });
  });

  it('loads nothing while the URL names no project', async () => {
    detach = attachUrlBinding(session);
    await flush();
    expect(StubEventSource.instances).toHaveLength(0);
  });

  it('loads the project the URL already names when it attaches', async () => {
    navigate('/city?src=%2Frepos%2Fa', { replace: true });
    detach = attachUrlBinding(session);
    await flush();

    expect(StubEventSource.instances).toHaveLength(1);
    expect(srcOf(0)).toBe('/repos/a');
  });

  it('loads the new project when the URL changes under it', async () => {
    // The reported bug: Back to a different ?src moved the address bar and
    // left the old city on screen, because the URL was read once at mount.
    navigate('/city?src=%2Frepos%2Fa', { replace: true });
    detach = attachUrlBinding(session);
    await flush();
    await complete('a');

    navigate('/city?src=%2Frepos%2Fb');
    await flush();

    expect(StubEventSource.instances).toHaveLength(2);
    expect(srcOf(1)).toBe('/repos/b');
  });

  // A remote keeps the branch the server resolved, so committing it writes
  // ?branch into the URL and moves the identity this effect watches.
  it('does not reload a fresh clone when its resolved branch lands in the URL', async () => {
    navigate('/city?src=https%3A%2F%2Fgithub.com%2Fo%2Fr', { replace: true });
    detach = attachUrlBinding(session);
    await flush();

    const es = StubEventSource.instances[StubEventSource.instances.length - 1]!;
    es.emit(
      'manifest-complete',
      JSON.stringify({ manifest: { tree: { name: 'o/r' }, repo: { branch: 'main' } } })
    );
    await flush();

    expect(ROUTE_PARAMS.value.get('branch'), 'the load should fill the branch in').toBe('main');
    expect(StubEventSource.instances, 'the repo on screen must not be re-scanned').toHaveLength(1);
  });

  // The other half of the guard above: filling a branch in must not cost the
  // ability to change one, which is a different project as far as a scan cares.
  it('reloads when the URL asks for a different branch of the same repo', async () => {
    const REMOTE = '/city?src=https%3A%2F%2Fgithub.com%2Fo%2Fr';
    navigate(REMOTE, { replace: true });
    detach = attachUrlBinding(session);
    await flush();
    StubEventSource.instances[0]!.emit(
      'manifest-complete',
      JSON.stringify({ manifest: { tree: { name: 'o/r' }, repo: { branch: 'main' } } })
    );
    await flush();
    expect(StubEventSource.instances).toHaveLength(1);

    navigate(`${REMOTE}&branch=dev`);
    await flush();

    expect(StubEventSource.instances).toHaveLength(2);
    expect(branchOf(1)).toBe('dev');
  });

  it('does not reload the project already on screen', async () => {
    navigate('/city?src=%2Frepos%2Fa', { replace: true });
    detach = attachUrlBinding(session);
    await flush();
    await complete('a');

    // A view param changing is not a different project.
    navigate('/city?src=%2Frepos%2Fa&sel=file%3Aa.ts');
    await flush();

    expect(StubEventSource.instances).toHaveLength(1);
  });

  // Nothing on this machine can know whether a scan from an hour ago still
  // holds. The server decides that, per open, off its own cache.
  it('re-asks the server for the project you just left and came back to', async () => {
    navigate('/city?src=%2Frepos%2Fa', { replace: true });
    detach = attachUrlBinding(session);
    await flush();
    await complete('a');
    expect(StubEventSource.instances).toHaveLength(1);

    navigate(ROUTES.HOME);
    await flush();
    navigate('/city?src=%2Frepos%2Fa');
    await flush();

    expect(StubEventSource.instances, 'the same project, asked for again').toHaveLength(2);
    expect(srcOf(1)).toBe('/repos/a');
  });

  it('a canceled load leaves its URL loadable', async () => {
    // The claim stops a re-run restarting an in-flight load. Held past one that
    // never committed, it leaves the URL naming a repo the city never loads.
    navigate('/city?src=%2Frepos%2Fa', { replace: true });
    detach = attachUrlBinding(session);
    await flush();
    await complete('a');

    navigate('/city?src=%2Frepos%2Fb');
    await flush();
    expect(StubEventSource.instances).toHaveLength(2);
    session.load.cancel();
    await flush();
    expect(session.source.current.value?.src, 'cancel did not commit b').toBe('/repos/a');

    // Asking for b again has to actually ask again.
    navigate(ROUTES.HOME, { replace: true });
    await flush();
    navigate('/city?src=%2Frepos%2Fb');
    await flush();
    expect(StubEventSource.instances).toHaveLength(3);
  });

  it('stops following the URL once detached', async () => {
    navigate('/city?src=%2Frepos%2Fa', { replace: true });
    detach = attachUrlBinding(session);
    await flush();
    await complete('a');

    detach();
    navigate('/city?src=%2Frepos%2Fb');
    await flush();

    expect(StubEventSource.instances).toHaveLength(1);
  });
});
