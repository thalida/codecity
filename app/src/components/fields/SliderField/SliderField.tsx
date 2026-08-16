// components/fields/SliderField/SliderField.tsx — Range slider with live readout.
// `step` controls the readout precision (a step of 0.0001 shows 4 decimals;
// integer steps drop the decimal).

import './SliderField.css';

export interface SliderFieldProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
  describedBy?: string;
  /** id so a row label can associate via htmlFor. */
  id?: string;
}

export function formatNumberForStep(v: number, step: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(step) >= 1) return v.toFixed(0);
  const stepStr = String(step);
  const dot = stepStr.indexOf('.');
  let decimals = dot === -1 ? 0 : stepStr.length - dot - 1;
  if (decimals > 6) decimals = 6;
  return v.toFixed(decimals);
}

export function SliderField({
  value,
  min,
  max,
  step,
  onCommit,
  describedBy,
  id,
}: SliderFieldProps) {
  return (
    <span class="setting-slider-wrap">
      <input
        type="range"
        class="setting-slider"
        id={id}
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
      <span class="setting-slider-readout">{formatNumberForStep(value, step)}</span>
    </span>
  );
}
