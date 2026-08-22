import { describe, it, expect, beforeEach } from 'vitest';
import { CHANGED_SETTINGS_COUNT } from '@/state/settings/indicators';
import { LIVE_UPDATES } from '@/state/settings/fields/updates';
import { ACCENT_THEME, ACCENT_THEME_DEFAULT } from '@/state/settings/fields/theme';
import { BUILDINGS } from '@/state/settings/fields/buildings';
import { EXCLUDES } from '@/state/stores/source';
import { getDefault } from '@/state/persist';
import { getFieldKeys } from '@/state/settings/schema';
import { makeSession } from '../../_helpers/project';

// One project for this file, the way the app makes one for itself.
const session = makeSession();

beforeEach(() => {
  LIVE_UPDATES.value = getDefault(LIVE_UPDATES);
  ACCENT_THEME.value = ACCENT_THEME_DEFAULT;
  BUILDINGS.value = getDefault(BUILDINGS);
  EXCLUDES.value = {};
  session.source.current.value = { src: 's', branch: undefined };
});

describe('CHANGED_SETTINGS_COUNT', () => {
  // The dot marks what the Settings icon can take you to. Everything below now
  // lives in a chrome-bar popover, so none of it may light the dot.
  it('ignores excludes and scan settings, which live in the header menu', () => {
    const base = CHANGED_SETTINGS_COUNT.value;

    session.source.addExclude('vendor');
    expect(CHANGED_SETTINGS_COUNT.value).toBe(base);
    session.source.clearExcludes();

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
    expect(CHANGED_SETTINGS_COUNT.value).toBeGreaterThan(base);
  });
});
