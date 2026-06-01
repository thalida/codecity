// views/panes/controls/Field.tsx — One generic settings row, driven entirely
// by the field's schema definition (looked up by store + key). Dispatches on
// `kind` to the right primitive and wraps it in a Row (label + tip + reset).
//
// Replaces the per-kind Fields.tsx wrappers (ColorField/NumberField/
// SliderField/ToggleField/SelectField/RangePairField) — the metadata they
// duplicated in JSX now lives once in the store schema.

import { FieldKind, getFieldDef } from '@/state/settings/schema';
import { useField } from '@/hooks/useField';
import { Row } from './Row';
import { ColorInput } from '@/views/components/ColorInput';
import { NumberInput } from '@/views/components/NumberInput';
import { Slider } from '@/views/components/Slider';
import { Toggle } from '@/views/components/Toggle';
import { SegmentedSelect } from '@/views/components/SegmentedSelect';
import { RangePair } from '@/views/components/RangePair';

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
  if (!def) {
    // Misconfigured schema (a (store, key) with no field def). The
    // completeness test catches this; log + render nothing as a safety net.
    console.error(`[controls] <Field> has no schema for key "${fieldKey}"`);
    return null;
  }

  let control;
  switch (def.kind) {
    case FieldKind.Color:
      control = <ColorInput value={binding.value as string} onCommit={binding.onCommit} />;
      break;
    case FieldKind.Number:
      control = (
        <NumberInput
          value={binding.value as number}
          min={def.min!}
          max={def.max!}
          step={def.step!}
          onCommit={binding.onCommit}
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
        />
      );
      break;
    case FieldKind.Toggle:
      control = <Toggle checked={!!binding.value} onCommit={binding.onCommit} />;
      break;
    case FieldKind.Select:
      control = (
        <SegmentedSelect
          value={binding.value as string}
          options={def.options!}
          onCommit={binding.onCommit}
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
        />
      );
      break;
    }
  }

  return (
    <Row label={def.label} tip={def.tip} store={store} keys={[fieldKey]}>
      {control}
    </Row>
  );
}
