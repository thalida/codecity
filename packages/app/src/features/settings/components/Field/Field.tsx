// features/settings/components/Field/Field.tsx — one settings row for any field, driven by its schema:
// dispatch on `kind` to the right primitive, wrapped in a Row. The metadata a
// per-kind wrapper would duplicate lives once in the store.

import { useId } from 'preact/hooks';
import { FieldKind, getFieldDef } from '@/features/settings/state/schema';
import { useField } from '@/hooks/useSettings';
import { FieldRow } from '@/features/settings/components/FieldRow/FieldRow';
import { TierWidthsField } from '@/features/settings/components/TierWidthsField/TierWidthsField';
import { HueMapField } from '@/features/settings/components/HueMapField/HueMapField';
import { ColorField } from '@/features/settings/components/ColorField/ColorField';
import { NumberField } from '@/features/settings/components/NumberField/NumberField';
import { SliderField } from '@/features/settings/components/SliderField/SliderField';
import { ToggleField } from '@/features/settings/components/ToggleField/ToggleField';
import { SelectField } from '@/features/settings/components/SelectField/SelectField';
import { RangePairField } from '@/features/settings/components/RangePairField/RangePairField';

interface SignalLike {
  get value(): unknown;
  set value(v: unknown);
}

export interface FieldProps {
  store: SignalLike;
  fieldKey: string;
  /** Drop the tip to hover-and-AT only (see FieldRow). */
  compact?: boolean;
}

export function Field({ store, fieldKey, compact }: FieldProps) {
  const def = getFieldDef(store as object, fieldKey);
  // Unconditional, per hook rules: the guard below only fires on a schema a
  // completeness test would already have failed.
  const binding = useField(store, fieldKey);
  const descId = useId();
  const controlId = useId();
  const describedBy = def?.tip ? descId : undefined;
  if (!def) {
    // Misconfigured schema (a (store, key) with no field def). The
    // completeness test catches this; log + render nothing as a safety net.
    console.error(`[controls] <Field> has no schema for key "${fieldKey}"`);
    return null;
  }

  // These expand to one row per entry, so they bring their own rows rather
  // than a single wrapped control.
  if (def.kind === FieldKind.TierWidths) {
    return <TierWidthsField store={store} fieldKey={fieldKey} />;
  }
  if (def.kind === FieldKind.HueMap) {
    return <HueMapField store={store} fieldKey={fieldKey} />;
  }

  let control;
  switch (def.kind) {
    case FieldKind.Color:
      control = (
        <ColorField
          value={binding.value as string}
          onCommit={binding.onCommit}
          describedBy={describedBy}
          id={controlId}
        />
      );
      break;
    case FieldKind.Number:
      control = (
        <NumberField
          value={binding.value as number}
          min={def.min!}
          max={def.max!}
          step={def.step!}
          onCommit={binding.onCommit}
          describedBy={describedBy}
          id={controlId}
        />
      );
      break;
    case FieldKind.SliderField:
      control = (
        <SliderField
          value={binding.value as number}
          min={def.min!}
          max={def.max!}
          step={def.step!}
          onCommit={binding.onCommit}
          describedBy={describedBy}
          id={controlId}
        />
      );
      break;
    case FieldKind.ToggleField:
      control = (
        <ToggleField
          checked={!!binding.value}
          onCommit={binding.onCommit}
          describedBy={describedBy}
          id={controlId}
        />
      );
      break;
    case FieldKind.Select:
      control = (
        <SelectField
          value={binding.value as string}
          options={def.options!}
          onCommit={binding.onCommit}
          describedBy={describedBy}
          label={def.label}
        />
      );
      break;
    case FieldKind.RangePairField: {
      const [lo, hi] = binding.value as [number, number];
      control = (
        <RangePairField
          lo={lo}
          hi={hi}
          min={def.min!}
          max={def.max!}
          step={def.step!}
          onCommit={(l, h) => binding.onCommit([l, h] as never)}
          describedBy={describedBy}
          id={controlId}
          label={def.label}
        />
      );
      break;
    }
  }

  // Compact controls sit inline (control to the right of the label); wide
  // controls (slider, range-pair) stay stacked full-width.
  const inline =
    def.kind === FieldKind.ToggleField ||
    def.kind === FieldKind.Color ||
    def.kind === FieldKind.Number ||
    def.kind === FieldKind.Select;
  return (
    <FieldRow
      label={def.label}
      tip={def.tip}
      compact={compact}
      inline={inline}
      descId={def.tip ? descId : undefined}
      // Select renders a button group (no single labelable field); it's named
      // in its own control, so don't point the row label at a missing id.
      htmlFor={def.kind === FieldKind.Select ? undefined : controlId}
      store={store}
      keys={[fieldKey]}
    >
      {control}
    </FieldRow>
  );
}
