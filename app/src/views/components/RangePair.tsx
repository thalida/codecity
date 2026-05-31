// views/components/RangePair.tsx — Dual-thumb range slider with a single
// readout ("lo – hi"). Used for paired min/max settings where the two
// values share a track and the user drags either thumb. When the user
// drags one past the other, the laggard snaps so lo ≤ hi is maintained.

import { formatNumberForStep } from './Slider';

export interface RangePairProps {
  lo: number;
  hi: number;
  min: number;
  max: number;
  step: number;
  onCommit: (lo: number, hi: number) => void;
}

export function RangePair({ lo, hi, min, max, step, onCommit }: RangePairProps) {
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
    <span class="theme-slider-wrap">
      <span class="theme-range-pair">
        <span class="theme-range-pair-track" />
        <span class="theme-range-pair-fill" style={{ left: fillLeft, right: fillRight }} />
        <input
          type="range"
          class="theme-range-pair-lo"
          min={String(min)}
          max={String(max)}
          step={String(step)}
          value={String(lo)}
          onInput={onInputLo}
        />
        <input
          type="range"
          class="theme-range-pair-hi"
          min={String(min)}
          max={String(max)}
          step={String(step)}
          value={String(hi)}
          onInput={onInputHi}
        />
      </span>
      <span class="theme-slider-readout">
        {formatNumberForStep(lo, step)} – {formatNumberForStep(hi, step)}
      </span>
    </span>
  );
}
