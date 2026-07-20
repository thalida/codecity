// views/ControlsPane/partials/FilePreviewSection.tsx — file-preview editor
// theme picker. SYNTAX_THEME is autosave (write-through): setDraft/stageReset
// restyle the open Monaco editor immediately, no Save step.

import { getEffective, setDraft, stageReset } from '@/state/settingsDrafts';
import { DRAFTS_REV } from '@/state/settingsDrafts';
import {
  SYNTAX_THEME,
  SYNTAX_THEME_DEFAULT,
  SYNTAX_THEME_OPTIONS,
} from '@/state/stores/settings/syntaxTheme';
import { RotateCcw } from 'lucide-preact';
import { SettingRow } from '@/components/SettingRow/SettingRow';
import { Section } from '@/components/Section/Section';

export function FilePreviewSection() {
  void DRAFTS_REV.value; // re-render on draft/commit changes
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
    <Section
      name="File preview"
      defaultOpen
      onReset={() => stageReset(SYNTAX_THEME, null)}
      resetEnabled={!isDefault}
      resetTitle="Reset file preview to default"
    >
      <SettingRow
        label="Syntax theme"
        tip="Color theme for the file preview editor; applies immediately."
        inline
        resetSlot={resetBtn}
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
      </SettingRow>
    </Section>
  );
}
