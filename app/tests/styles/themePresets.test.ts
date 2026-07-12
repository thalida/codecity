import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCENT_PRESETS,
  SURFACE_PRESETS,
  ACCENT_THEME_DEFAULT,
  SURFACE_THEME_DEFAULT,
} from '@/state/stores/settings/theme';

// `new URL('literal', import.meta.url)` is Vite's static asset-URL pattern —
// it gets rewritten to a dev-server URL, not a file:// path. Resolve via
// __dirname (matches shader-source tests elsewhere in tests/) instead.
const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dirname, '../../src/styles/themes.css'), 'utf8');

describe('themes.css preset blocks', () => {
  it('defines a data-cc-accent block for every non-default accent preset', () => {
    for (const p of ACCENT_PRESETS) {
      if (p.value === ACCENT_THEME_DEFAULT) continue;
      expect(css).toContain(`[data-cc-accent='${p.value}']`);
    }
  });

  it('defines a data-cc-surface block for every non-default surface preset', () => {
    for (const p of SURFACE_PRESETS) {
      if (p.value === SURFACE_THEME_DEFAULT) continue;
      expect(css).toContain(`[data-cc-surface='${p.value}']`);
    }
  });

  it('defines no block for the default preset (tokens.css stands)', () => {
    expect(css).not.toContain(`[data-cc-accent='${ACCENT_THEME_DEFAULT}']`);
    expect(css).not.toContain(`[data-cc-surface='${SURFACE_THEME_DEFAULT}']`);
  });
});
