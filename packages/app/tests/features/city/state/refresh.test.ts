// The header's Refresh re-reads whatever you are looking at. WHAT that means is
// the city's: in Timeline it re-reads the history holding the scrub, because a
// live re-scan would answer "show me this again" by leaving the mode. This app
// used to know that rule and route around it; the city owns it now.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fakeCity } from '@codecity/city/testing';
import type { City } from '@codecity/city';

import { refreshCurrentSource } from '@/features/city/state/commands';
import { CURRENT_SOURCE } from '@/state/source';
import { EXCLUDES } from '@/state/excludes';

describe('refreshCurrentSource', () => {
  let city: ReturnType<typeof fakeCity>;
  let asked: Array<{ noCache?: boolean; excludes?: () => string[] | undefined }>;

  beforeEach(() => {
    asked = [];
    city = fakeCity();
    (city as unknown as { refreshSource: (o: never) => void }).refreshSource = (o) => asked.push(o);
    CURRENT_SOURCE.value = { src: 'https://github.com/o/r' };
  });

  afterEach(() => {
    CURRENT_SOURCE.value = null;
    EXCLUDES.value = {};
  });

  const refresh = (skipCache = false) => refreshCurrentSource(city as unknown as City, skipCache);

  it('asks the city to read what it is showing again', () => {
    refresh();
    expect(asked).toHaveLength(1);
  });

  it('carries a fresh scan through, so the server cannot answer from cache', () => {
    refresh(true);
    expect(asked[0]).toMatchObject({ noCache: true });
  });

  // In Timeline too: one call, and the city decides what re-reading means.
  it('asks the same way in Timeline, since that rule is the city’s', () => {
    city.timeline.enter();
    refresh();
    expect(asked).toHaveLength(1);
  });

  it('hands over the paths this reader has hidden, read per ask', () => {
    EXCLUDES.value = { [Object.keys(EXCLUDES.value)[0] ?? 'k']: [] };
    refresh();
    expect(typeof asked[0].excludes).toBe('function');
  });

  it('does nothing without a city', () => {
    refreshCurrentSource(null, false);
    expect(asked).toHaveLength(0);
  });
});
