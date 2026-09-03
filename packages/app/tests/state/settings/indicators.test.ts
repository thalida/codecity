import { CITY_STORES } from '@/features/settings/state/values/city';
import { describe, it, expect, beforeEach } from 'vitest';
import { CHANGED_SETTINGS_COUNT } from '@/features/settings/state/indicators';
import { LIVE_UPDATES } from '@/features/settings/state/values/updates';
import { ACCENT_THEME, ACCENT_THEME_DEFAULT } from '@/features/settings/state/values/theme';
import { CURRENT_SOURCE } from '@/state/source';
import { EXCLUDES, addExclude, clearExcludes } from '@/state/excludes';
import { getDefault } from '@/lib/persist';
import { getFieldKeys } from '@/features/settings/state/schema';

beforeEach(() => {
  LIVE_UPDATES.value = getDefault(LIVE_UPDATES);
  ACCENT_THEME.value = ACCENT_THEME_DEFAULT;
  CITY_STORES.BUILDINGS.value = getDefault(CITY_STORES.BUILDINGS);
  EXCLUDES.value = {};
  CURRENT_SOURCE.value = { src: 's', branch: undefined };
});

describe('CHANGED_SETTINGS_COUNT', () => {
  // The dot marks what the Settings icon can take you to. Everything below now
  // lives in a chrome-bar popover, so none of it may light the dot.
  it('ignores excludes and scan settings, which live in the header menu', () => {
    const base = CHANGED_SETTINGS_COUNT.value;

    addExclude('vendor');
    expect(CHANGED_SETTINGS_COUNT.value).toBe(base);
    clearExcludes();

    LIVE_UPDATES.value = { ...LIVE_UPDATES.value, POLL_SECONDS: 42 };
    expect(CHANGED_SETTINGS_COUNT.value).toBe(base);
  });

  it('ignores the theme pickers, which live in the footer menu', () => {
    const base = CHANGED_SETTINGS_COUNT.value;
    ACCENT_THEME.value = (ACCENT_THEME_DEFAULT as string) === 'blue' ? 'green' : 'blue';
    expect(CHANGED_SETTINGS_COUNT.value).toBe(base);
  });

  it('counts a changed World field, which the pane does hold', () => {
    const base = CHANGED_SETTINGS_COUNT.value;
    const key = getFieldKeys(CITY_STORES.BUILDINGS)[0];
    const cur = (CITY_STORES.BUILDINGS.value as Record<string, unknown>)[key];
    const next =
      typeof cur === 'boolean'
        ? !cur
        : typeof cur === 'number'
          ? cur + 1
          : Array.isArray(cur)
            ? [...cur, 0]
            : `${cur}__changed`;
    CITY_STORES.BUILDINGS.value = {
      ...(CITY_STORES.BUILDINGS.value as Record<string, unknown>),
      [key]: next,
    } as typeof CITY_STORES.BUILDINGS.value;
    expect(CHANGED_SETTINGS_COUNT.value).toBeGreaterThan(base);
  });
});
