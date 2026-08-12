import { describe, it, expect, beforeEach } from 'vitest';
import {
  CHANGED_SETTINGS_COUNT,
  APPEARANCE_COUNT,
  WORLD_COUNT,
} from '@/state/stores/settingsIndicators';
import { LIVE_UPDATES } from '@/state/stores/settings/updates';
import { ACCENT_THEME, ACCENT_THEME_DEFAULT } from '@/state/stores/settings/theme';
import { BUILDINGS } from '@/state/stores/settings/buildings';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { EXCLUDES, addExclude, clearExcludes } from '@/state/stores/excludes';
import { getDefault } from '@/state/persist';
import { getFieldKeys } from '@/state/settingsSchema';

beforeEach(() => {
  LIVE_UPDATES.value = getDefault(LIVE_UPDATES);
  ACCENT_THEME.value = ACCENT_THEME_DEFAULT;
  BUILDINGS.value = getDefault(BUILDINGS);
  EXCLUDES.value = {};
  CURRENT_SOURCE.value = { src: 's', branch: undefined };
});

describe('settings indicators', () => {
  // The dot marks what the Settings icon can take you to. Both of these now
  // live in the header's scan menu, so neither may light it.
  it('leaves the dot alone for excludes and for scan settings', () => {
    const base = CHANGED_SETTINGS_COUNT.value;

    addExclude('vendor');
    expect(CHANGED_SETTINGS_COUNT.value).toBe(base);
    clearExcludes();

    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, POLL_SECONDS: 42 };
    expect(CHANGED_SETTINGS_COUNT.value).toBe(base);
    expect(WORLD_COUNT.value).toBe(0);
    expect(APPEARANCE_COUNT.value).toBe(0);
  });

  it('a changed theme counts on Appearance and the total', () => {
    const base = CHANGED_SETTINGS_COUNT.value;
    expect(APPEARANCE_COUNT.value).toBe(0);
    ACCENT_THEME.value = (ACCENT_THEME_DEFAULT as string) === 'blue' ? 'green' : 'blue';
    expect(APPEARANCE_COUNT.value).toBe(1);
    expect(WORLD_COUNT.value).toBe(0);
    expect(CHANGED_SETTINGS_COUNT.value).toBe(base + 1);
  });

  it('a changed World field counts on World', () => {
    expect(WORLD_COUNT.value).toBe(0);
    const key = getFieldKeys(BUILDINGS)[0];
    const cur = (BUILDINGS.value as Record<string, unknown>)[key];
    const next =
      typeof cur === 'boolean'
        ? !cur
        : typeof cur === 'number'
          ? cur + 1
          : Array.isArray(cur)
            ? [...cur, 0]
            : `${cur}__changed`;
    BUILDINGS.value = {
      ...(BUILDINGS.value as Record<string, unknown>),
      [key]: next,
    } as typeof BUILDINGS.value;
    expect(WORLD_COUNT.value).toBeGreaterThan(0);
  });
});
