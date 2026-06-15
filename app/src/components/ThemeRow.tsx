// components/ThemeRow.tsx — Labeled control-panel row (renders .theme-row)
// used by every control widget. Renders the label, the control element passed
// in `children`, and (when `store` + `keys` are provided) a reset icon next to
// the control that stages-reset on click.
//
// `tip` is appended to the label-as-tooltip so users can hover and see
// what a knob does without expanding documentation.

import './ThemeRow.css';
import type { ComponentChildren } from 'preact';
import { ResetButton } from './ResetButton';

interface SignalLike {
  get value(): any;
  set value(v: any);
}

export interface ThemeRowProps {
  label: string;
  /** Extra hover text appended after `label — …` on the row title. */
  tip?: string;
  /** Store the reset button binds to. Omit (with `keys`) to suppress the reset. */
  store?: SignalLike | null;
  /** Keys this row covers. Required if `store` is set. */
  keys?: string[];
  children: ComponentChildren;
}

export function ThemeRow({ label, tip, store, keys, children }: ThemeRowProps) {
  const fullTip = tip ? `${label} — ${tip}` : label;
  return (
    <label class="theme-row" title={fullTip}>
      <span class="theme-row-label" title={fullTip}>
        {label}
      </span>
      <span class="theme-row-control">
        {children}
        {store && keys && keys.length > 0 && <ResetButton store={store} keys={keys} />}
      </span>
    </label>
  );
}
