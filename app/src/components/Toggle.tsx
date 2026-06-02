// components/Toggle.tsx — Thin <input type="checkbox"> wrapper.

export interface ToggleProps {
  checked: boolean;
  onCommit: (v: boolean) => void;
}

export function Toggle({ checked, onCommit }: ToggleProps) {
  return (
    <input
      type="checkbox"
      class="theme-toggle"
      checked={checked}
      onChange={(e) => onCommit((e.currentTarget as HTMLInputElement).checked)}
    />
  );
}
