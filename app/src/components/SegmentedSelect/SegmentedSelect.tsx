// components/SegmentedSelect.tsx — Segmented radio: one button per
// option, the selected option carries .is-active. Used for enum-valued
// settings (e.g. tier-spacing mode, layout strategy).

import './SegmentedSelect.css';

export interface SegmentedSelectOption {
  value: string;
  label: string;
}

export interface SegmentedSelectProps {
  value: string;
  options: SegmentedSelectOption[];
  onCommit: (v: string) => void;
  describedBy?: string;
}

export function SegmentedSelect({ value, options, onCommit, describedBy }: SegmentedSelectProps) {
  return (
    <span class="theme-select" role="group" aria-describedby={describedBy}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          class={`btn-toggle btn-toggle--separated${opt.value === value ? ' is-active' : ''}`}
          onClick={(e) => {
            e.preventDefault();
            onCommit(opt.value);
          }}
        >
          {opt.label}
        </button>
      ))}
    </span>
  );
}
