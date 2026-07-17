import { describe, it, expect, beforeEach } from 'vitest';
import {
  CHANGED_SETTINGS_COUNT,
  SCAN_COUNT,
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
  it('excludes count into the Scan total and the overall total only', () => {
    const base = CHANGED_SETTINGS_COUNT.value;
    expect(SCAN_COUNT.value).toBe(0);
    addExclude('vendor');
    expect(SCAN_COUNT.value).toBe(1);
    expect(APPEARANCE_COUNT.value).toBe(0);
    expect(CHANGED_SETTINGS_COUNT.value).toBe(base + 1);
    clearExcludes();
    expect(SCAN_COUNT.value).toBe(0);
    expect(CHANGED_SETTINGS_COUNT.value).toBe(base);
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
