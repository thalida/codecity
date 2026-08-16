// state/settings/fields/theme.ts — accent + surface presets, applied by setting
// data-cc-accent / data-cc-surface on <html>. The applier is a module-scope
// effect rather than a component so the first paint is already themed: main.tsx
// imports this before render() and persistedSignal hydrates synchronously.
import { effect } from '@preact/signals';
import { persistedSignal } from '@/state/persist';
import { markSettingStore, markAutosave } from '@/state/settings/schema';

export interface ThemePresetOption {
  value: string;
  label: string;
}

// Hue order. The applier omits the attribute for the default `purple`, so
// tokens.css :root stays the source; the picker chip previews it either way.
export const ACCENT_PRESETS: ThemePresetOption[] = [
  { value: 'amber', label: 'Amber' },
  { value: 'green', label: 'Green' },
  { value: 'cyan', label: 'Cyan' },
  { value: 'blue', label: 'Blue' },
  { value: 'purple', label: 'Purple' },
  { value: 'pink', label: 'Pink' },
];

// Surface presets — plain tint names. `cool` is the default.
export const SURFACE_PRESETS: ThemePresetOption[] = [
  { value: 'cool', label: 'Cool' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'green', label: 'Green' },
  { value: 'warm', label: 'Warm' },
];

export const ACCENT_THEME_DEFAULT = 'purple';
export const SURFACE_THEME_DEFAULT = 'cool';

export const ACCENT_THEME = persistedSignal<string>('ACCENT_THEME', ACCENT_THEME_DEFAULT);
export const SURFACE_THEME = persistedSignal<string>('SURFACE_THEME', SURFACE_THEME_DEFAULT);

// These live in the Appearance tab but use plain persistedSignals, so register
// + mark autosave explicitly (settingSignal would do this implicitly).
markSettingStore(ACCENT_THEME);
markAutosave(ACCENT_THEME);
markSettingStore(SURFACE_THEME);
markAutosave(SURFACE_THEME);

// Apply to <html>. The default preset removes its attribute so tokens.css
// wins; any other preset sets it so themes.css [data-cc-*] blocks override.
function applyThemeAttrs(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const accent = ACCENT_THEME.value;
  const surface = SURFACE_THEME.value;
  if (accent === ACCENT_THEME_DEFAULT) delete root.dataset.ccAccent;
  else root.dataset.ccAccent = accent;
  if (surface === SURFACE_THEME_DEFAULT) delete root.dataset.ccSurface;
  else root.dataset.ccSurface = surface;
}

// Runs synchronously at module eval and re-runs on either signal's change.
effect(applyThemeAttrs);
