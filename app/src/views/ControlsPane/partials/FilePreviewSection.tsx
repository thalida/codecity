// views/ControlsPane/FilePreviewSection.tsx — Syntax-highlight theme
// picker. Writes directly to SYNTAX_THEME (no draft layer — the CSS
// link element swaps instantly, no Save required). Mirrors the
// rotate-ccw reset affordance but wired to the SYNTAX_THEME signal.

import {
  SYNTAX_THEME,
  SYNTAX_THEME_DEFAULT,
  SYNTAX_THEME_OPTIONS,
} from '@/state/stores/settings/index';
import { RotateCcw } from 'lucide-preact';
import { Section } from '@/components/Section';

export function FilePreviewSection() {
  const current = SYNTAX_THEME.value;
  const defaultLabel =
    SYNTAX_THEME_OPTIONS.find((o) => o.value === SYNTAX_THEME_DEFAULT)?.label ?? SYNTAX_THEME_DEFAULT;
  const isDefault = current === SYNTAX_THEME_DEFAULT;

  return (
    <Section name="File Preview" hint="Syntax highlight theme for the code preview pane.">
      <label class="theme-row">
        <span class="theme-row-label">Syntax theme</span>
        <span class="theme-row-control">
          <select
            class="form-input form-input--select"
            value={current}
            onChange={(e) => {
              SYNTAX_THEME.value = (e.currentTarget as HTMLSelectElement).value;
            }}
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
              SYNTAX_THEME.value = SYNTAX_THEME_DEFAULT;
            }}
          >
            <RotateCcw class="lucide-icon" />
          </button>
        </span>
      </label>
    </Section>
  );
}
