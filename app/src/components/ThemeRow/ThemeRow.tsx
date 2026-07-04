// components/ThemeRow.tsx — Labeled control-panel row (renders .theme-row).
// Layout B (stacked): a head row (label + reset; plus the control itself for
// inline kinds like toggle/color), then — for stacked kinds — the full-width
// control, then the field's description when it has one.
//
// `tip` is shown inline as the description AND kept as the row's hover title.

import './ThemeRow.css';
import type { ComponentChildren } from 'preact';
import { ResetButton } from '../ResetButton/ResetButton';

interface SignalLike {
  get value(): any;
  set value(v: any);
}

export interface ThemeRowProps {
  label: string;
  /** One-line description, shown inline under the control and as the hover
   *  title. Omit for controls that need no explanation. */
  tip?: string;
  /** Toggle/color sit on the head row (a full-width control would look odd);
   *  everything else stacks the control full-width below the head row. */
  inline?: boolean;
  /** Store the reset button binds to. Omit (with `keys`) to suppress the reset. */
  store?: SignalLike | null;
  /** Keys this row covers. Required if `store` is set. */
  keys?: string[];
  children: ComponentChildren;
}

export function ThemeRow({ label, tip, inline, store, keys, children }: ThemeRowProps) {
  const fullTip = tip ? `${label} — ${tip}` : label;
  const reset = store && keys && keys.length > 0 ? <ResetButton store={store} keys={keys} /> : null;
  return (
    <label class={inline ? 'theme-row theme-row--inline' : 'theme-row'} title={fullTip}>
      <span class="theme-row-head">
        <span class="theme-row-label">{label}</span>
        {inline && <span class="theme-row-control">{children}</span>}
        {reset}
      </span>
      {!inline && <span class="theme-row-control">{children}</span>}
      {tip && <span class="theme-row-desc">{tip}</span>}
    </label>
  );
}
