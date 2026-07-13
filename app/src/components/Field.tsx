// components/Field.tsx — One generic settings row, driven entirely
// by the field's schema definition (looked up by store + key). Dispatches on
// `kind` to the right primitive and wraps it in a Row (label + tip + reset).
//
// Replaces the per-kind Fields.tsx wrappers (ColorField/NumberField/
// SliderField/ToggleField/SelectField/RangePairField) — the metadata they
// duplicated in JSX now lives once in the store schema.

import { useId } from 'preact/hooks';
import { FieldKind, getFieldDef } from '@/state/settingsSchema';
import { useField } from '@/hooks/useSettings';
import { ThemeRow } from './ThemeRow/ThemeRow';
import { TierWidthsField } from './TierWidthsField';
import { HueMapField } from './HueMapField/HueMapField';
import { ColorInput } from '@/components/ColorInput/ColorInput';
import { NumberInput } from '@/components/NumberInput';
import { Slider } from '@/components/Slider/Slider';
import { Toggle } from '@/components/Toggle/Toggle';
import { SegmentedSelect } from '@/components/SegmentedSelect/SegmentedSelect';
import { RangePair } from '@/components/RangePair/RangePair';

interface SignalLike {
  get value(): unknown;
  set value(v: unknown);
}

export interface FieldProps {
  store: SignalLike;
  fieldKey: string;
}

export function Field({ store, fieldKey }: FieldProps) {
  const def = getFieldDef(store as object, fieldKey);
  // useField must run unconditionally (hook rules); the early-return guard
  // below only fires for a misconfigured schema, which a completeness test
  // catches — so in practice the hook always runs with a real field.
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

  // TierWidths / HueMap are array/object-valued fields that expand to one row
  // per entry, so they render their own rows rather than a single Row-wrapped
  // control.
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
        <ColorInput
          value={binding.value as string}
          onCommit={binding.onCommit}
          describedBy={describedBy}
          id={controlId}
        />
      );
      break;
    case FieldKind.Number:
      control = (
        <NumberInput
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
    case FieldKind.Slider:
      control = (
        <Slider
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
    case FieldKind.Toggle:
      control = (
        <Toggle
          checked={!!binding.value}
          onCommit={binding.onCommit}
          describedBy={describedBy}
          id={controlId}
        />
      );
      break;
    case FieldKind.Select:
      control = (
        <SegmentedSelect
          value={binding.value as string}
          options={def.options!}
          onCommit={binding.onCommit}
          describedBy={describedBy}
        />
      );
      break;
    case FieldKind.RangePair: {
      const [lo, hi] = binding.value as [number, number];
      control = (
        <RangePair
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
    def.kind === FieldKind.Toggle ||
    def.kind === FieldKind.Color ||
    def.kind === FieldKind.Number ||
    def.kind === FieldKind.Select;
  return (
    <ThemeRow
      label={def.label}
      tip={def.tip}
      inline={inline}
      descId={def.tip ? descId : undefined}
      // Select renders a button group (no single labelable field); it's named
      // in its own control, so don't point the row label at a missing id.
      htmlFor={def.kind === FieldKind.Select ? undefined : controlId}
      store={store}
      keys={[fieldKey]}
    >
      {control}
    </ThemeRow>
  );
}
