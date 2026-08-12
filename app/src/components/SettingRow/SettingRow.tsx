// components/SettingRow.tsx — Labeled control-panel row (renders .setting-row).
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
  /** Drop the tip to hover-and-AT only. For rows in a popover, where a
   *  paragraph under every control outweighs the controls. */
  compact?: boolean;
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
  compact,
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
  // A <label> only where there's a control to point it at. Without `for` it
  // implicitly labels its first labelable descendant — which is the reset
  // button, so the row's text named the reset and hovering anywhere in the row
  // forwarded :hover to it.
  const Main = htmlFor ? 'label' : 'div';
  return (
    <div class={inline ? 'setting-row setting-row--inline' : 'setting-row'}>
      <Main class="setting-row-main" htmlFor={htmlFor} title={fullTip}>
        <span class="setting-row-head">
          <span class="setting-row-label">{label}</span>
          {inline && <span class="setting-row-control">{children}</span>}
          {reset}
        </span>
        {!inline && <span class="setting-row-control">{children}</span>}
      </Main>
      {/* Compact keeps the tip for the hover title and aria-describedby, and
          drops only the visible block. */}
      {tip && (
        <span class={compact ? 'sr-only' : 'setting-row-desc'} id={descId}>
          {tip}
        </span>
      )}
    </div>
  );
}
