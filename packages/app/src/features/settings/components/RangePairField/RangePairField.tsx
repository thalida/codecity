// features/settings/components/RangePairField/RangePairField.tsx — Dual-thumb range slider with a single
// readout ("lo – hi"). Used for paired min/max settings where the two
// values share a track and the user drags either thumb. When the user
// drags one past the other, the laggard snaps so lo ≤ hi is maintained.

import './RangePairField.css';
import { formatNumberForStep } from '../SliderField/SliderField';

export interface RangePairFieldProps {
  lo: number;
  hi: number;
  min: number;
  max: number;
  step: number;
  onCommit: (lo: number, hi: number) => void;
  describedBy?: string;
  /** id for the lo thumb (hi derives `${id}-hi`) so a row label can associate. */
  id?: string;
  /** Field label, used to give each thumb a distinct accessible name. */
  label?: string;
}

export function RangePairField({
  lo,
  hi,
  min,
  max,
  step,
  onCommit,
  describedBy,
  id,
  label,
}: RangePairFieldProps) {
  const span = max - min || 1;
  const fillLeft = `${((lo - min) / span) * 100}%`;
  const fillRight = `${((max - hi) / span) * 100}%`;

  function onInputLo(e: Event) {
    let v = parseFloat((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    if (v > hi) v = hi;
    onCommit(v, hi);
  }
  function onInputHi(e: Event) {
    let v = parseFloat((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    if (v < lo) v = lo;
    onCommit(lo, v);
  }

  return (
    <span class="setting-slider-wrap">
      <span class="setting-range-pair">
        <span class="setting-range-pair-track" />
        <span class="setting-range-pair-fill" style={{ left: fillLeft, right: fillRight }} />
        <input
          type="range"
          class="setting-range-pair-lo"
          id={id}
          min={String(min)}
          max={String(max)}
          step={String(step)}
          value={String(lo)}
          aria-label={label ? `${label} minimum` : 'Minimum'}
          aria-describedby={describedBy}
          onInput={onInputLo}
        />
        <input
          type="range"
          class="setting-range-pair-hi"
          id={id ? `${id}-hi` : undefined}
          min={String(min)}
          max={String(max)}
          step={String(step)}
          value={String(hi)}
          aria-label={label ? `${label} maximum` : 'Maximum'}
          aria-describedby={describedBy}
          onInput={onInputHi}
        />
      </span>
      <span class="setting-slider-readout">
        {formatNumberForStep(lo, step)} – {formatNumberForStep(hi, step)}
      </span>
    </span>
  );
}
