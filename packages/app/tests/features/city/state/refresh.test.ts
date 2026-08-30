// The header's Refresh re-reads whatever you are looking at. In Timeline that
// is the history bundle: a live re-scan would answer it by leaving the mode.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fakeCity, installEventSource, StubEventSource } from '@codecity/city/testing';
import type { City } from '@codecity/city';

import { refreshCurrentSource, setTimelineRefreshHandler } from '@/features/city/state/commands';
import { CURRENT_SOURCE } from '@/state/source';

describe('refreshCurrentSource', () => {
  let restoreEventSource: () => void;
  let refreshes: Array<{ noCache?: boolean; overlay?: boolean } | undefined>;
  let city: ReturnType<typeof fakeCity>;
  let liveRescans: Array<{ noCache?: boolean }>;

  beforeEach(() => {
    restoreEventSource = installEventSource();
    refreshes = [];
    liveRescans = [];
    setTimelineRefreshHandler((_city, opts) => {
      refreshes.push(opts);
      return Promise.resolve();
    });
    city = fakeCity();
    (city as unknown as { refreshSource: (o: { noCache?: boolean }) => void }).refreshSource = (
      o
    ) => liveRescans.push(o);
    CURRENT_SOURCE.value = { src: 'https://github.com/o/r' };
  });

  afterEach(() => {
    restoreEventSource();
    setTimelineRefreshHandler(null);
    CURRENT_SOURCE.value = null;
  });

  const refresh = (skipCache: boolean) => refreshCurrentSource(city as unknown as City, skipCache);

  it('re-reads the history bundle in place, staying in Timeline', () => {
    city.timeline.enter();

    refresh(false);

    // overlay: asked for by hand, so it reports its stages like a Live refresh.
    expect(refreshes).toEqual([{ noCache: false, overlay: true }]);
    expect(city.timeline.mode).toBe(true);
    expect(liveRescans, 'no live re-scan').toEqual([]);
  });

  it('re-scans live when that is the mode', () => {
    refresh(false);

    expect(refreshes).toEqual([]);
    expect(liveRescans).toHaveLength(1);
  });

  // Fresh scan is "ignore the cache", not "leave Timeline": the bundle caches
  // per HEAD like the live scan does, so the flag rides the history read.
  it('carries a fresh scan into the history read, staying in Timeline', () => {
    city.timeline.enter();

    refresh(true);

    expect(refreshes).toEqual([{ noCache: true, overlay: true }]);
    expect(city.timeline.mode).toBe(true);
  });

  it('sends no_cache on a live fresh scan', () => {
    refresh(true);

    expect(liveRescans[0]).toMatchObject({ noCache: true });
  });

  it('does nothing without a city', () => {
    refreshCurrentSource(null, false);

    expect(refreshes).toEqual([]);
    expect(StubEventSource.instances).toHaveLength(0);
  });
});
