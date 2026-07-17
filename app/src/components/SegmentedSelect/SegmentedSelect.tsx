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
  /** Names the radiogroup (the field label). */
  label?: string;
}

export function SegmentedSelect({
  value,
  options,
  onCommit,
  describedBy,
  label,
}: SegmentedSelectProps) {
  // A single-select radiogroup: arrow keys move + select (automatic activation),
  // wrapping at the ends; Home/End jump. Focus follows to the checked option,
  // which is the group's single tab stop (roving tabindex).
  function onKeyDown(e: KeyboardEvent, idx: number) {
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (idx + 1) % options.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (idx - 1 + options.length) % options.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = options.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    onCommit(options[next].value);
    const group = (e.currentTarget as HTMLElement).parentElement;
    (group?.children[next] as HTMLElement | undefined)?.focus();
  }

  return (
    <span
      class="setting-select"
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
    >
      {options.map((opt, idx) => {
        const checked = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            class={`btn-toggle btn-toggle--separated${checked ? ' is-active' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              onCommit(opt.value);
            }}
            onKeyDown={(e) => onKeyDown(e, idx)}
          >
            {opt.label}
          </button>
        );
      })}
    </span>
  );
}
