// components/Toggle.tsx — Thin <input type="checkbox"> wrapper.

import './Toggle.css';

export interface ToggleProps {
  checked: boolean;
  onCommit: (v: boolean) => void;
  describedBy?: string;
  /** id so a row label can associate via htmlFor. */
  id?: string;
}

export function Toggle({ checked, onCommit, describedBy, id }: ToggleProps) {
  return (
    <input
      type="checkbox"
      class="theme-toggle"
      id={id}
      checked={checked}
      aria-describedby={describedBy}
      onChange={(e) => onCommit((e.currentTarget as HTMLInputElement).checked)}
    />
  );
}
