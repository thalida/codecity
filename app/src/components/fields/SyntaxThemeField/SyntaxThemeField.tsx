// components/fields/SyntaxThemeField/SyntaxThemeField.tsx — highlight theme for the file
// preview. Autosave: setDraft/stageReset swap the CSS <link> immediately.

import { useId } from 'preact/hooks';
import { RotateCcw } from 'lucide-preact';
import { getEffective, setDraft, stageReset } from '@/state/settings/drafts';
import {
  SYNTAX_THEME,
  SYNTAX_THEME_DEFAULT,
  SYNTAX_THEME_OPTIONS,
} from '@/state/settings/fields/syntaxTheme';
import { FieldRow } from '@/components/fields/FieldRow/FieldRow';

export interface SyntaxThemeFieldProps {
  /** Drop the tip to hover-and-AT only (see FieldRow). */
  compact?: boolean;
}

export function SyntaxThemeField({ compact }: SyntaxThemeFieldProps) {
  const selectId = useId();
  const current = (getEffective(SYNTAX_THEME, null) as string) ?? SYNTAX_THEME_DEFAULT;
  const defaultLabel =
    SYNTAX_THEME_OPTIONS.find((o) => o.value === SYNTAX_THEME_DEFAULT)?.label ??
    SYNTAX_THEME_DEFAULT;
  const isDefault = current === SYNTAX_THEME_DEFAULT;

  const resetBtn = (
    <button
      type="button"
      class="setting-row-reset"
      title={`Default: ${defaultLabel}`}
      aria-label="Reset syntax theme to default"
      disabled={isDefault}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        stageReset(SYNTAX_THEME, null);
      }}
    >
      <RotateCcw class="icon" />
    </button>
  );

  return (
    <FieldRow
      label="Syntax theme"
      tip="Highlight theme for the file preview."
      compact={compact}
      inline
      htmlFor={selectId}
      resetSlot={resetBtn}
    >
      <select
        id={selectId}
        class="form-input form-input--select"
        value={current}
        onChange={(e) => setDraft(SYNTAX_THEME, null, (e.currentTarget as HTMLSelectElement).value)}
      >
        {SYNTAX_THEME_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}
