// views/components/ColorInput.tsx — Thin <input type="color"> wrapper.
// HTML's color input only accepts `#rrggbb`; we round-trip any CSS color
// through a temporary DOM probe to normalize it.

export interface ColorInputProps {
  value: string;
  onCommit: (hex: string) => void;
}

function _toHexInputValue(cssColor: string | unknown): string {
  if (typeof cssColor !== 'string') return '#000000';
  if (/^#[0-9a-fA-F]{6}$/.test(cssColor)) return cssColor.toLowerCase();
  if (typeof document === 'undefined') return '#000000';
  const probe = document.createElement('span');
  probe.style.color = cssColor;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color; // "rgb(R, G, B)"
  document.body.removeChild(probe);
  const m = computed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#000000';
  const r = parseInt(m[1], 10).toString(16).padStart(2, '0');
  const g = parseInt(m[2], 10).toString(16).padStart(2, '0');
  const b = parseInt(m[3], 10).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

export function ColorInput({ value, onCommit }: ColorInputProps) {
  return (
    <input
      type="color"
      class="theme-color"
      value={_toHexInputValue(value)}
      onInput={(e) => onCommit((e.currentTarget as HTMLInputElement).value)}
    />
  );
}
