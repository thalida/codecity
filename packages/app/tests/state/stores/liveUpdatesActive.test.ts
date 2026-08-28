import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CURRENT_SOURCE, CURRENT_SOURCE_IS_LOCAL } from '@/state/stores/source';
import { LIVE_UPDATES, LIVE_UPDATES_ACTIVE } from '@/state/settings/values/updates';

const LOCAL = { src: '/Users/me/projects/codecity' };
const REMOTE = { src: 'https://github.com/thalida/codecity', branch: 'main' };

describe('CURRENT_SOURCE_IS_LOCAL', () => {
  beforeEach(() => {
    CURRENT_SOURCE.value = null;
  });
  afterEach(() => {
    CURRENT_SOURCE.value = null;
  });

  it('is false before anything is loaded', () => {
    expect(CURRENT_SOURCE_IS_LOCAL.value).toBe(false);
  });

  it('is true for a path on disk and false for a clone', () => {
    CURRENT_SOURCE.value = LOCAL;
    expect(CURRENT_SOURCE_IS_LOCAL.value).toBe(true);
    CURRENT_SOURCE.value = REMOTE;
    expect(CURRENT_SOURCE_IS_LOCAL.value).toBe(false);
  });

  it('recomputes on a switch, so it never reports the previous source', () => {
    CURRENT_SOURCE.value = REMOTE;
    expect(CURRENT_SOURCE_IS_LOCAL.value).toBe(false);
    CURRENT_SOURCE.value = LOCAL;
    expect(CURRENT_SOURCE_IS_LOCAL.value).toBe(true);
  });
});

describe('LIVE_UPDATES_ACTIVE', () => {
  const enabled = LIVE_UPDATES.peek().ENABLED;

  beforeEach(() => {
    CURRENT_SOURCE.value = null;
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: true };
  });
  afterEach(() => {
    CURRENT_SOURCE.value = null;
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: enabled };
  });

  // A clone is fetched once and never re-fetched, so its content_signature
  // cannot move: polling it is a scan that can never report anything.
  it('stays off for a remote source even with the toggle on', () => {
    CURRENT_SOURCE.value = REMOTE;
    expect(LIVE_UPDATES.value.ENABLED).toBe(true);
    expect(LIVE_UPDATES_ACTIVE.value).toBe(false);
  });

  it('runs for a local source with the toggle on', () => {
    CURRENT_SOURCE.value = LOCAL;
    expect(LIVE_UPDATES_ACTIVE.value).toBe(true);
  });

  it('still honours the toggle for a local source', () => {
    CURRENT_SOURCE.value = LOCAL;
    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, ENABLED: false };
    expect(LIVE_UPDATES_ACTIVE.value).toBe(false);
  });

  it('turns on when switching from a clone to a working tree', () => {
    CURRENT_SOURCE.value = REMOTE;
    expect(LIVE_UPDATES_ACTIVE.value).toBe(false);
    CURRENT_SOURCE.value = LOCAL;
    expect(LIVE_UPDATES_ACTIVE.value).toBe(true);
  });
});
