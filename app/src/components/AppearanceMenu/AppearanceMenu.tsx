// components/AppearanceMenu/AppearanceMenu.tsx — how the app looks, in the
// footer: the header is the project, the footer is the app, and a theme is not
// a fact about the repo you have open. Autosave, so there is no Save to explain.
import { Palette } from 'lucide-preact';
import { SwatchRow } from '@/components/SwatchRow/SwatchRow';
import { Popover, PopoverPlacement } from '@/components/Popover/Popover';
import { SyntaxThemeRow } from '@/components/SyntaxThemeRow/SyntaxThemeRow';
import { DRAFTS_REV } from '@/state/settings/drafts';
import {
  ACCENT_THEME,
  ACCENT_THEME_DEFAULT,
  ACCENT_PRESETS,
  SURFACE_THEME,
  SURFACE_THEME_DEFAULT,
  SURFACE_PRESETS,
} from '@/state/settings/fields/theme';

const PANEL_LABEL = 'Appearance';

export function AppearanceMenu() {
  void DRAFTS_REV.value; // re-render on write-through / reset

  return (
    <Popover
      label={PANEL_LABEL}
      placement={PopoverPlacement.AboveStart}
      triggerTitle={PANEL_LABEL}
      trigger={<Palette class="icon" aria-hidden="true" />}
    >
      {() => (
        <>
          <section class="popover-group">
            <SwatchRow
              label="Accent"
              tip="Accent color for buttons, links, and highlights."
              axis="accent"
              store={ACCENT_THEME}
              options={ACCENT_PRESETS}
              defaultValue={ACCENT_THEME_DEFAULT}
              compact
            />
            <SwatchRow
              label="Surface"
              tip="Background palette for panels and chrome."
              axis="surface"
              store={SURFACE_THEME}
              options={SURFACE_PRESETS}
              defaultValue={SURFACE_THEME_DEFAULT}
              compact
            />
          </section>

          <section class="popover-group">
            <SyntaxThemeRow compact />
          </section>
        </>
      )}
    </Popover>
  );
}
