// components/SwatchRow/SwatchRow.tsx — one theme axis as a row of colour
// swatches: a radiogroup with one tab stop, where arrow keys move focus AND
// selection (the WAI-ARIA radio pattern).
//
// A chip carries the same data-cc-* attribute its preset uses, so its colour
// resolves from themes.css with no duplicated hex. Reset is hand-rolled because
// ResetButton only supports keyed object stores and these are scalar signals.

import './SwatchRow.css';
import { useRef } from 'preact/hooks';
import { RotateCcw } from 'lucide-preact';
import { getEffective, setDraft, stageReset } from '@/state/settingsDrafts';
import type { ThemePresetOption } from '@/state/stores/settings/theme';
import { SettingRow } from '@/components/SettingRow/SettingRow';

interface SignalLike {
  get value(): string;
  set value(v: string);
}

export interface SwatchRowProps {
  label: string;
  tip: string;
  axis: 'accent' | 'surface';
  store: SignalLike;
  options: ThemePresetOption[];
  defaultValue: string;
  /** Drop the tip to hover-and-AT only (see SettingRow). */
  compact?: boolean;
}

export function SwatchRow({
  label,
  tip,
  axis,
  store,
  options,
  defaultValue,
  compact,
}: SwatchRowProps) {
  const current = (getEffective(store, null) as string) ?? defaultValue;
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === current)
  );
  // Accent chips show the flat accent; surface chips show the full surface
  // ladder as a gradient (app -> chrome -> sidebar) so the otherwise near-black
  // tint reads at the lighter sidebar end and the presets are distinguishable.
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
    <SettingRow label={label} tip={tip} compact={compact} resetSlot={resetBtn}>
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
    </SettingRow>
  );
}
