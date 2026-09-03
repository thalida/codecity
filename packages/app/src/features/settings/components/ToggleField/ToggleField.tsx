// features/settings/components/ToggleField/ToggleField.tsx — Thin <input type="checkbox"> wrapper.

import './ToggleField.css';

export interface ToggleFieldProps {
  checked: boolean;
  onCommit: (v: boolean) => void;
  describedBy?: string;
  /** id so a row label can associate via htmlFor. */
  id?: string;
  /** Shown but not operable: hiding it would move the layout, and a live-looking
   *  switch would imply the setting could apply here. */
  disabled?: boolean;
}

export function ToggleField({ checked, onCommit, describedBy, id, disabled }: ToggleFieldProps) {
  return (
    <input
      type="checkbox"
      class="setting-toggle"
      id={id}
      checked={checked}
      disabled={disabled}
      aria-describedby={describedBy}
      onChange={(e) => onCommit((e.currentTarget as HTMLInputElement).checked)}
    />
  );
}
