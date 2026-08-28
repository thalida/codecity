// The app reads the SCENE CITY's timeline, not a copy. Everything else in
// timeline.test.ts runs against the detached stand-in, which answers the same
// way whether or not the bridge to a real city works — so this drives a
// published scene handle, which is the only configuration the app ever runs in.

import { describe, it, expect, afterEach } from 'vitest';
import {
  TIMELINE_MODE,
  TIMELINE_BUNDLE,
  SCRUB_POS,
  beginTimelineMode,
  resetTimelineMode,
  setTimelineBundle,
  setScrubPos,
} from '@/state/stores/timeline';
import { stubSceneCity } from '../../_helpers/sceneCity';
import { makeCommitBundle } from '@codecity/city/testing';

let city: ReturnType<typeof stubSceneCity> | null = null;

afterEach(() => {
  city?.dispose();
  city = null;
});

describe('the app reads the scene city’s timeline', () => {
  it('sees the mode the city entered', () => {
    city = stubSceneCity();
    expect(TIMELINE_MODE.value).toBe(false);

    beginTimelineMode();

    expect(city.timeline.mode).toBe(true);
    expect(TIMELINE_MODE.value).toBe(true);
  });

  it('sees the mode go again on exit', () => {
    city = stubSceneCity();
    beginTimelineMode();
    expect(TIMELINE_MODE.value).toBe(true);

    resetTimelineMode();

    expect(TIMELINE_MODE.value).toBe(false);
  });

  it('sees the bundle and the position the city holds', () => {
    city = stubSceneCity();
    const bundle = makeCommitBundle(4);

    beginTimelineMode();
    setTimelineBundle(bundle);
    setScrubPos(2);

    expect(TIMELINE_BUNDLE.value).toBe(bundle);
    expect(SCRUB_POS.value).toBe(2);
  });

  // The handle is published after the app has already read a value off the
  // detached stand-in, which is the real boot order: the store's module runs
  // long before the canvas mounts.
  it('rebinds when the city arrives after the first read', () => {
    expect(TIMELINE_MODE.value).toBe(false);

    city = stubSceneCity();
    city.timeline.enter();

    expect(TIMELINE_MODE.value).toBe(true);
  });

  // A city going away must not leave the app reporting its mode.
  it('stops reading a city that has been torn down', () => {
    city = stubSceneCity();
    beginTimelineMode();
    expect(TIMELINE_MODE.value).toBe(true);

    city.dispose();
    city = null;

    expect(TIMELINE_MODE.value).toBe(false);
  });
});
