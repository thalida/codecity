// What OVERLAY_OPEN means: something other than the scene owns the keyboard, so
// the scene's shortcuts must not fire underneath it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  OVERLAY_OPEN,
  openShortcuts,
  closeShortcuts,
  openDebug,
  closeDebug,
} from '@/state/stores/chrome';
import { navigate } from '@/router/location';
import { ROUTES } from '@/router/paths';

describe('OVERLAY_OPEN', () => {
  beforeEach(() => navigate(ROUTES.CITY, { replace: true }));
  afterEach(() => {
    closeShortcuts();
    closeDebug();
    navigate(ROUTES.HOME, { replace: true });
  });

  it('is false on a city with nothing open', () => {
    expect(OVERLAY_OPEN.value).toBe(false);
  });

  it('is true while either panel is open', () => {
    openShortcuts();
    expect(OVERLAY_OPEN.value).toBe(true);
    closeShortcuts();

    openDebug();
    expect(OVERLAY_OPEN.value).toBe(true);
  });

  it('is true on the landing, whose form owns the keyboard', () => {
    navigate(ROUTES.HOME);
    expect(OVERLAY_OPEN.value).toBe(true);
  });
});
