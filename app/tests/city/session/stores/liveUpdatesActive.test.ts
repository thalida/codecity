import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LIVE_UPDATES, liveUpdatesActive } from '@/city/session/settings/updates';
import { makeSession } from '../../../_helpers/city';

// One city for this file, the way the app makes one for itself.
const session = makeSession();

const LOCAL = { src: '/Users/me/projects/codecity' };
const REMOTE = { src: 'https://github.com/thalida/codecity', branch: 'main' };

describe('CURRENT_SOURCE_IS_LOCAL', () => {
  beforeEach(() => {
    session.source.current.value = null;
  });
  afterEach(() => {
    session.source.current.value = null;
  });

  it('is false before anything is loaded', () => {
    expect(session.source.isLocal.value).toBe(false);
  });

  it('is true for a path on disk and false for a clone', () => {
    session.source.current.value = LOCAL;
    expect(session.source.isLocal.value).toBe(true);
    session.source.current.value = REMOTE;
    expect(session.source.isLocal.value).toBe(false);
  });

  it('recomputes on a switch, so it never reports the previous source', () => {
    session.source.current.value = REMOTE;
    expect(session.source.isLocal.value).toBe(false);
    session.source.current.value = LOCAL;
    expect(session.source.isLocal.value).toBe(true);
  });
});

describe('LIVE_UPDATES_ACTIVE', () => {
  const enabled = LIVE_UPDATES.peek().ENABLED;

  beforeEach(() => {
    session.source.current.value = null;
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: true };
  });
  afterEach(() => {
    session.source.current.value = null;
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: enabled };
  });

  // A clone is fetched once and never re-fetched, so its content_signature
  // cannot move: polling it is a scan that can never report anything.
  it('stays off for a remote source even with the toggle on', () => {
    session.source.current.value = REMOTE;
    expect(LIVE_UPDATES.value.ENABLED).toBe(true);
    expect(liveUpdatesActive(session.source)).toBe(false);
  });

  it('runs for a local source with the toggle on', () => {
    session.source.current.value = LOCAL;
    expect(liveUpdatesActive(session.source)).toBe(true);
  });

  it('still honours the toggle for a local source', () => {
    session.source.current.value = LOCAL;
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: false };
    expect(liveUpdatesActive(session.source)).toBe(false);
  });

  it('turns on when switching from a clone to a working tree', () => {
    session.source.current.value = REMOTE;
    expect(liveUpdatesActive(session.source)).toBe(false);
    session.source.current.value = LOCAL;
    expect(liveUpdatesActive(session.source)).toBe(true);
  });
});
