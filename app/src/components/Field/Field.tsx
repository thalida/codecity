// components/Field — one settings row for any field, driven by its schema:
// dispatch on `kind` to the right primitive, wrapped in a Row. The metadata a
// per-kind wrapper would duplicate lives once in the store.

import { useId } from 'preact/hooks';
import { FieldKind, getFieldDef } from '@/state/settings/schema';
import { useField } from '@/hooks/useSettings';
import { SettingRow } from '@/components/SettingRow/SettingRow';
import { TierWidthsField } from '@/components/TierWidthsField/TierWidthsField';
import { HueMapField } from '@/components/HueMapField/HueMapField';
import { ColorInput } from '@/components/ColorInput/ColorInput';
import { NumberInput } from '@/components/NumberInput/NumberInput';
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
  /** Drop the tip to hover-and-AT only (see SettingRow). */
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
          label={def.label}
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
    <SettingRow
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
    </SettingRow>
  );
}
