// components/fields/SwatchField/SwatchField.tsx — one theme axis as a radiogroup of colour
// chips, arrow keys moving focus and selection together. Each chip carries the
// data-cc-* attribute its preset uses, so no hex is duplicated. Reset is
// hand-rolled: ResetButton only handles keyed stores, and these are scalars.
import './SwatchField.css';
import { useRef } from 'preact/hooks';
import { RotateCcw } from 'lucide-preact';
import { getEffective, setDraft, stageReset } from '@/state/settings/drafts';
import type { ThemePresetOption } from '@/state/settings/fields/theme';
import { FieldRow } from '@/components/fields/FieldRow/FieldRow';

interface SignalLike {
  get value(): string;
  set value(v: string);
}

export interface SwatchFieldProps {
  label: string;
  tip: string;
  axis: 'accent' | 'surface';
  store: SignalLike;
  options: ThemePresetOption[];
  defaultValue: string;
  /** Drop the tip to hover-and-AT only (see FieldRow). */
  compact?: boolean;
}

export function SwatchField({
  label,
  tip,
  axis,
  store,
  options,
  defaultValue,
  compact,
}: SwatchFieldProps) {
  const current = (getEffective(store, null) as string) ?? defaultValue;
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === current)
  );
  // Surface chips show the whole ladder as a gradient: the tint is near-black
  // at the app end and only tells presets apart at the sidebar end.
  const chipVar =
    axis === 'accent'
      ? 'var(--cc-accent)'
      : 'linear-gradient(135deg, var(--cc-bg-app), var(--cc-bg-chrome), var(--cc-bg-sidebar))';
  const defaultLabel = options.find((o) => o.value === defaultValue)?.label ?? defaultValue;

  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (value: string) => setDraft(store, null, value);

  const onKeyDown = (e: KeyboardEvent) => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!delta) return;
    e.preventDefault();
    // Move selection AND focus together (WAI-ARIA radiogroup): flipping
    // tabIndex on re-render doesn't move the browser's focus, so do it here.
    const next = (activeIndex + delta + options.length) % options.length;
    select(options[next].value);
    btnRefs.current[next]?.focus();
  };

  const resetBtn = (
    <button
      type="button"
      class="setting-row-reset"
      title={`Default: ${defaultLabel}`}
      aria-label={`Reset ${label.toLowerCase()} to default`}
      disabled={current === defaultValue}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        stageReset(store, null);
      }}
    >
      <RotateCcw class="icon" />
    </button>
  );

  return (
    <FieldRow label={label} tip={tip} compact={compact} resetSlot={resetBtn}>
      <span class="swatch-group" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
        {options.map((opt, i) => {
          const checked = opt.value === current;
          return (
            <button
              key={opt.value}
              ref={(el) => {
                btnRefs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={opt.label}
              title={opt.label}
              tabIndex={i === activeIndex ? 0 : -1}
              class={checked ? 'swatch is-active' : 'swatch'}
              onClick={() => select(opt.value)}
            >
              <span
                class="swatch-chip"
                style={{ background: chipVar }}
                {...{ [`data-cc-${axis}`]: opt.value }}
              />
              <span class="swatch-label">{opt.label}</span>
            </button>
          );
        })}
      </span>
    </FieldRow>
  );
}
