// views/ControlsPane/partials/FilePreviewSection.tsx — Syntax-highlight theme
// picker. SYNTAX_THEME is autosave (write-through): setDraft/stageReset apply
// the CSS <link> swap immediately, no Save step.

import { getEffective, setDraft, stageReset } from '@/state/settingsDrafts';
import { DRAFTS_REV } from '@/state/settingsDrafts';
import {
  SYNTAX_THEME,
  SYNTAX_THEME_DEFAULT,
  SYNTAX_THEME_OPTIONS,
} from '@/state/stores/settings/syntaxTheme';
import { RotateCcw } from 'lucide-preact';
import { Section } from '@/components/Section/Section';
import { ThemeRow } from '@/components/ThemeRow/ThemeRow';

export function FilePreviewSection() {
  void DRAFTS_REV.value; // re-render on draft/commit changes
  const current = (getEffective(SYNTAX_THEME, null) as string) ?? SYNTAX_THEME_DEFAULT;
  const defaultLabel =
    SYNTAX_THEME_OPTIONS.find((o) => o.value === SYNTAX_THEME_DEFAULT)?.label ??
    SYNTAX_THEME_DEFAULT;
  const isDefault = current === SYNTAX_THEME_DEFAULT;

  return (
    <Section name="File Preview" hint="Syntax highlight theme for the code preview pane.">
      <ThemeRow
        label="Syntax theme"
        tip="Highlight theme for the file preview; applies immediately."
      >
        <select
          class="form-input form-input--select"
          value={current}
          onChange={(e) =>
            setDraft(SYNTAX_THEME, null, (e.currentTarget as HTMLSelectElement).value)
          }
        >
          {SYNTAX_THEME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          class="theme-row-reset"
          title={`Default: ${defaultLabel}`}
          aria-label="Reset syntax theme to default"
          disabled={isDefault}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            stageReset(SYNTAX_THEME, null);
          }}
        >
          <RotateCcw class="lucide-icon" />
        </button>
      </ThemeRow>
    </Section>
  );
}
