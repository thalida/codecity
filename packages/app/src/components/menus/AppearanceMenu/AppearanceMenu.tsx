// components/menus/AppearanceMenu/AppearanceMenu.tsx — how the app looks, in the
// footer: the header is the project, the footer is the app, and a theme is not
// a fact about the repo you have open. Autosave, so there is no Save to explain.
import { Palette } from 'lucide-preact';
import { SwatchField } from '@/components/fields/SwatchField/SwatchField';
import { Popover, PopoverPlacement } from '@/components/menus/Popover/Popover';
import { SyntaxThemeField } from '@/components/fields/SyntaxThemeField/SyntaxThemeField';
import { DRAFTS_REV } from '@/state/settings/drafts';
import {
  ACCENT_THEME,
  ACCENT_THEME_DEFAULT,
  ACCENT_PRESETS,
  SURFACE_THEME,
  SURFACE_THEME_DEFAULT,
  SURFACE_PRESETS,
} from '@/state/settings/values/theme';

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
            <SwatchField
              label="Accent"
              tip="Accent color for buttons, links, and highlights."
              axis="accent"
              store={ACCENT_THEME}
              options={ACCENT_PRESETS}
              defaultValue={ACCENT_THEME_DEFAULT}
              compact
            />
            <SwatchField
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
            <SyntaxThemeField compact />
          </section>
        </>
      )}
    </Popover>
  );
}
