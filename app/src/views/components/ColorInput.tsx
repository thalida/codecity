// views/components/ColorInput.tsx — Thin <input type="color"> wrapper.
// HTML's color input only accepts `#rrggbb`; the app's colors are always
// hex, so we normalize through a pure helper (no DOM probe).

import { normalizeHex } from '@/utils/colors';

export interface ColorInputProps {
  value: string;
  onCommit: (hex: string) => void;
}

export function ColorInput({ value, onCommit }: ColorInputProps) {
  return (
    <input
      type="color"
      class="theme-color"
      value={normalizeHex(value)}
      onInput={(e) => onCommit((e.currentTarget as HTMLInputElement).value)}
    />
  );
}
