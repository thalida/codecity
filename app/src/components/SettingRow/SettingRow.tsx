// components/SettingRow.tsx — Labeled control-panel row (renders .theme-row).
// Layout B (stacked): a head row (label + reset; plus the control itself for
// inline kinds like toggle/color), then — for stacked kinds — the full-width
// control, then the field's description when it has one.
//
// `tip` is shown inline as the description AND kept as the row's hover title.
// The description sits OUTSIDE the <label> (a sibling, not a child): a
// wrapping <label>'s text becomes the control's accessible name, so nesting
// the description in it would bloat every control's a11y name and (for
// inline toggle/color rows) make clicking the description text activate the
// control. The caller wires it back via aria-describedby using `descId`.

import './SettingRow.css';
import type { ComponentChildren } from 'preact';
import { ResetButton } from '../ResetButton/ResetButton';

interface SignalLike {
  get value(): any;
  set value(v: any);
}

export interface SettingRowProps {
  label: string;
  /** One-line description, shown inline under the control and as the hover
   *  title. Omit for controls that need no explanation. */
  tip?: string;
  /** Toggle/color sit on the head row (a full-width control would look odd);
   *  everything else stacks the control full-width below the head row. */
  inline?: boolean;
  /** id for the description element so the control can aria-describedby it. */
  descId?: string;
  /** id of the control this row labels; associates the label via htmlFor.
   *  Omit for controls that are not a single labelable field (e.g. a button
   *  group), which carry their own accessible name. */
  htmlFor?: string;
  /** Store the reset button binds to. Omit (with `keys`) to suppress the reset. */
  store?: SignalLike | null;
  /** Keys this row covers. Required if `store` is set. */
  keys?: string[];
  /** Custom reset control for the head (e.g. a per-entry reset for array fields
   *  like TierWidths / HueMap). Renders in the same head slot as the store/keys
   *  ResetButton so every row's reset lines up. */
  resetSlot?: ComponentChildren;
  children: ComponentChildren;
}

export function SettingRow({
  label,
  tip,
  inline,
  descId,
  htmlFor,
  store,
  keys,
  resetSlot,
  children,
}: SettingRowProps) {
  const fullTip = tip ? `${label}: ${tip}` : label;
  const reset =
    resetSlot ??
    (store && keys && keys.length > 0 ? <ResetButton store={store} keys={keys} /> : null);
  return (
    <div class={inline ? 'theme-row theme-row--inline' : 'theme-row'}>
      <label class="theme-row-main" htmlFor={htmlFor} title={fullTip}>
        <span class="theme-row-head">
          <span class="theme-row-label">{label}</span>
          {inline && <span class="theme-row-control">{children}</span>}
          {reset}
        </span>
        {!inline && <span class="theme-row-control">{children}</span>}
      </label>
      {tip && (
        <span class="theme-row-desc" id={descId}>
          {tip}
        </span>
      )}
    </div>
  );
}
