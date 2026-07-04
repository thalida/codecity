// components/Toggle.tsx — Thin <input type="checkbox"> wrapper.

import './Toggle.css';

export interface ToggleProps {
  checked: boolean;
  onCommit: (v: boolean) => void;
  describedBy?: string;
}

export function Toggle({ checked, onCommit, describedBy }: ToggleProps) {
  return (
    <input
      type="checkbox"
      class="theme-toggle"
      checked={checked}
      aria-describedby={describedBy}
      onChange={(e) => onCommit((e.currentTarget as HTMLInputElement).checked)}
    />
  );
}
