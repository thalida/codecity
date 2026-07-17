// components/ColorInput.tsx — Thin <input type="color"> wrapper.
// HTML's color input only accepts `#rrggbb`; the app's colors are always
// hex, so we normalize through a pure helper (no DOM probe).

import './ColorInput.css';
import { normalizeHex } from '@/utils/colors';

export interface ColorInputProps {
  value: string;
  onCommit: (hex: string) => void;
  describedBy?: string;
  /** id so a row label can associate via htmlFor. */
  id?: string;
}

export function ColorInput({ value, onCommit, describedBy, id }: ColorInputProps) {
  return (
    <input
      type="color"
      class="setting-color"
      id={id}
      value={normalizeHex(value)}
      aria-describedby={describedBy}
      onInput={(e) => onCommit((e.currentTarget as HTMLInputElement).value)}
    />
  );
}
