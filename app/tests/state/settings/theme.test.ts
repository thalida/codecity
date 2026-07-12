import { describe, it, expect, afterEach } from 'vitest';
import {
  ACCENT_THEME,
  SURFACE_THEME,
  ACCENT_THEME_DEFAULT,
  SURFACE_THEME_DEFAULT,
  ACCENT_PRESETS,
  SURFACE_PRESETS,
} from '@/state/stores/settings/theme';

afterEach(() => {
  ACCENT_THEME.value = ACCENT_THEME_DEFAULT;
  SURFACE_THEME.value = SURFACE_THEME_DEFAULT;
});

describe('theme stores', () => {
  it('defaults are blue / cool and are the first preset of each list', () => {
    expect(ACCENT_THEME_DEFAULT).toBe('blue');
    expect(SURFACE_THEME_DEFAULT).toBe('cool');
    expect(ACCENT_PRESETS[0].value).toBe('blue');
    expect(SURFACE_PRESETS[0].value).toBe('cool');
    expect(ACCENT_PRESETS.map((p) => p.value)).toEqual([
      'blue',
      'cyan',
      'purple',
      'green',
      'pink',
      'amber',
    ]);
    expect(SURFACE_PRESETS.map((p) => p.value)).toEqual(['cool', 'neutral', 'green', 'warm']);
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
