import { describe, it, expect, beforeEach } from 'vitest';
import {
  CHANGED_SETTINGS_COUNT,
  SCAN_CHANGED,
  APPEARANCE_CHANGED,
  WORLD_CHANGED,
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
  it('excludes count into the total and flag the Scan tab only', () => {
    const base = CHANGED_SETTINGS_COUNT.value;
    expect(SCAN_CHANGED.value).toBe(false);
    addExclude('vendor');
    expect(SCAN_CHANGED.value).toBe(true);
    expect(APPEARANCE_CHANGED.value).toBe(false);
    expect(CHANGED_SETTINGS_COUNT.value).toBe(base + 1);
    clearExcludes();
    expect(SCAN_CHANGED.value).toBe(false);
    expect(CHANGED_SETTINGS_COUNT.value).toBe(base);
  });

  it('a changed theme flags Appearance and adds to the count', () => {
    const base = CHANGED_SETTINGS_COUNT.value;
    expect(APPEARANCE_CHANGED.value).toBe(false);
    ACCENT_THEME.value = (ACCENT_THEME_DEFAULT as string) === 'blue' ? 'green' : 'blue';
    expect(APPEARANCE_CHANGED.value).toBe(true);
    expect(WORLD_CHANGED.value).toBe(false);
    expect(CHANGED_SETTINGS_COUNT.value).toBe(base + 1);
  });

  it('a changed World field flags World', () => {
    expect(WORLD_CHANGED.value).toBe(false);
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
    expect(WORLD_CHANGED.value).toBe(true);
  });
});
