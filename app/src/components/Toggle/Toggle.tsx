// components/Toggle.tsx — Thin <input type="checkbox"> wrapper.

import './Toggle.css';

export interface ToggleProps {
  checked: boolean;
  onCommit: (v: boolean) => void;
  describedBy?: string;
  /** id so a row label can associate via htmlFor. */
  id?: string;
  /** Shown but not operable, and not focusable: for a setting that cannot
   *  apply in the current context, where hiding it would move the layout and
   *  a live-looking switch would imply it could be turned on. */
  disabled?: boolean;
}

export function Toggle({ checked, onCommit, describedBy, id, disabled }: ToggleProps) {
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
