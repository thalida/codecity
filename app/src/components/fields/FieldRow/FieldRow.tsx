// components/fields/FieldRow/FieldRow.tsx — a labelled control-panel row.
// The description sits OUTSIDE the <label>, wired back with aria-describedby: a
// wrapping label's text becomes the control's accessible name, which would bloat
// every one of them and make clicking the description toggle inline controls.
import './FieldRow.css';
import type { ComponentChildren } from 'preact';
import { ResetButton } from '@/components/buttons/ResetButton/ResetButton';

interface SignalLike {
  get value(): any;
  set value(v: any);
}

export interface FieldRowProps {
  label: string;
  /** One-line description, shown inline under the control and as the hover
   *  title. Omit for controls that need no explanation. */
  tip?: string;
  /** Drop the tip to hover-and-AT only. For rows in a popover, where a
   *  paragraph under every control outweighs the controls. */
  compact?: boolean;
  /** ToggleField/color sit on the head row (a full-width control would look odd);
   *  everything else stacks the control full-width below the head row. */
  inline?: boolean;
  /** id for the description element so the control can aria-describedby it. */
  descId?: string;
  /** id of the control this row labels. Omit for anything that is not one
   *  labelable field, which carries its own accessible name. */
  htmlFor?: string;
  /** Store the reset button binds to. Omit (with `keys`) to suppress the reset. */
  store?: SignalLike | null;
  /** Keys this row covers. Required if `store` is set. */
  keys?: string[];
  /** Custom reset for the head, in the same slot as the store/keys ResetButton
   *  so every row's reset lines up. */
  resetSlot?: ComponentChildren;
  children: ComponentChildren;
}

export function FieldRow({
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
}: FieldRowProps) {
  const fullTip = tip ? `${label}: ${tip}` : label;
  const reset =
    resetSlot ??
    (store && keys && keys.length > 0 ? <ResetButton store={store} keys={keys} /> : null);
  // Only where there is a control to point at: without `for`, a label adopts
  // its first labelable descendant, which is the reset button.
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
