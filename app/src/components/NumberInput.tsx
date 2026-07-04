// components/NumberInput.tsx — Thin <input type="number"> wrapper.
// Validates parseFloat → onCommit only when the parse succeeds, so partial
// edits (an empty string while the user is mid-type) don't fire.

export interface NumberInputProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
  describedBy?: string;
}

export function NumberInput({ value, min, max, step, onCommit, describedBy }: NumberInputProps) {
  return (
    <input
      type="number"
      class="form-input form-input--mono"
      min={String(min)}
      max={String(max)}
      step={String(step)}
      value={String(value)}
      aria-describedby={describedBy}
      onInput={(e) => {
        const v = parseFloat((e.currentTarget as HTMLInputElement).value);
        if (Number.isFinite(v)) onCommit(v);
      }}
    />
  );
}
