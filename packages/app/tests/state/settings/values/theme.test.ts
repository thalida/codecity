import { describe, it, expect, afterEach } from 'vitest';
import {
  ACCENT_THEME,
  SURFACE_THEME,
  ACCENT_THEME_DEFAULT,
  SURFACE_THEME_DEFAULT,
  ACCENT_PRESETS,
  SURFACE_PRESETS,
} from '@/features/settings/state/values/theme';

afterEach(() => {
  ACCENT_THEME.value = ACCENT_THEME_DEFAULT;
  SURFACE_THEME.value = SURFACE_THEME_DEFAULT;
});

describe('theme stores', () => {
  it('defaults are purple / cool; accents are in rainbow order', () => {
    expect(ACCENT_THEME_DEFAULT).toBe('purple');
    expect(SURFACE_THEME_DEFAULT).toBe('cool');
    // Accents ordered by hue (rainbow), not with the default first.
    expect(ACCENT_PRESETS.map((p) => p.value)).toEqual([
      'amber',
      'green',
      'cyan',
      'blue',
      'purple',
      'pink',
    ]);
    expect(SURFACE_PRESETS.map((p) => p.value)).toEqual(['cool', 'neutral', 'green', 'warm']);
    // Each default is a real member of its list.
    expect(ACCENT_PRESETS.some((p) => p.value === ACCENT_THEME_DEFAULT)).toBe(true);
    expect(SURFACE_PRESETS.some((p) => p.value === SURFACE_THEME_DEFAULT)).toBe(true);
  });

  it('sets no html attribute for the default preset', () => {
    ACCENT_THEME.value = ACCENT_THEME_DEFAULT;
    SURFACE_THEME.value = SURFACE_THEME_DEFAULT;
    expect(document.documentElement.dataset.ccAccent).toBeUndefined();
    expect(document.documentElement.dataset.ccSurface).toBeUndefined();
  });

  it('sets data-cc-accent / data-cc-surface for non-default presets, reactively', () => {
    ACCENT_THEME.value = 'cyan';
    SURFACE_THEME.value = 'warm';
    expect(document.documentElement.getAttribute('data-cc-accent')).toBe('cyan');
    expect(document.documentElement.getAttribute('data-cc-surface')).toBe('warm');
  });

  it('clears the attribute when returning to the default preset', () => {
    ACCENT_THEME.value = 'green';
    expect(document.documentElement.dataset.ccAccent).toBe('green');
    ACCENT_THEME.value = ACCENT_THEME_DEFAULT;
    expect(document.documentElement.dataset.ccAccent).toBeUndefined();
  });
});
