// views/panes/controls/Field.tsx — One generic settings row, driven entirely
// by the field's schema definition (looked up by store + key). Dispatches on
// `kind` to the right primitive and wraps it in a Row (label + tip + reset).
//
// Replaces the per-kind Fields.tsx wrappers (ColorField/NumberField/
// SliderField/ToggleField/SelectField/RangePairField) — the metadata they
// duplicated in JSX now lives once in the store schema.

import { FieldKind, getFieldDef } from '@/state/settings/schema';
import { useField } from '@/hooks/useField';
import { useEffective, useDefault } from './hooks';
import { setDraft } from '@/state/drafts';
import type { StreetTier } from '@/state/settings/streets';
import { RotateCcw } from 'lucide-preact';
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

// Renders the STREET_TIERS array (FieldKind.TierWidths): one width slider per
// tier, each with its own per-tier reset. The field's value is the whole
// StreetTier[]; every edit commits a fresh array via the draft layer.
function TierWidthsField({ store, fieldKey }: FieldProps) {
  const tiers = useEffective<StreetTier[]>(store, fieldKey) ?? [];
  const defaults = useDefault<StreetTier[]>(store, fieldKey) ?? [];
  const commit = (next: StreetTier[]) => setDraft(store, fieldKey, next);

  return (
    <>
      {tiers.map((tier, i) => {
        const label = `${tier.min_descendants}+ descendants`;
        const tip = `${label} — World-unit width for streets in this descendant-count tier. Above ~256 streets overwhelm building footprints; below 1 they disappear.`;
        const defaultWidth = defaults[i]?.width;
        const disabled = tier.width === defaultWidth;
        return (
          <label class="theme-row" title={tip} key={`tier-${i}`}>
            <span class="theme-row-label" title={tip}>{label}</span>
            <span class="theme-row-control">
              <Slider
                value={tier.width}
                min={1}
                max={256}
                step={1}
                onCommit={(v) => {
                  const next = tiers.slice();
                  next[i] = { ...tiers[i], width: v };
                  commit(next);
                }}
              />
              <button
                type="button"
                class="theme-row-reset"
                title={`Default: ${defaultWidth}`}
                aria-label="Reset to default"
                disabled={disabled}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const next = tiers.slice();
                  next[i] = { ...tiers[i], width: defaultWidth };
                  commit(next);
                }}
              >
                <RotateCcw class="lucide-icon" />
              </button>
            </span>
          </label>
        );
      })}
    </>
  );
}

// Renders a { key: hue } map (FieldKind.HueMap): one 0–359° hue slider per key
// with a swatch preview + per-key reset. The field's value is the whole object;
// every edit commits a fresh merged object via the draft layer.
function HueMapField({ store, fieldKey }: FieldProps) {
  const map = useEffective<Record<string, number>>(store, fieldKey) ?? {};
  const defaults = useDefault<Record<string, number>>(store, fieldKey) ?? {};
  const commit = (next: Record<string, number>) => setDraft(store, fieldKey, next);

  return (
    <>
      {Object.keys(map).sort().map((k) => {
        const value = map[k];
        const defaultVal = defaults[k];
        const disabled = value === defaultVal;
        const tip = `${k} — Hue (0–359°) for files with this extension.`;
        return (
          <label class="theme-row" title={tip} key={k}>
            <span class="theme-row-label" title={tip}>{k}</span>
            <span class="theme-row-control">
              <Slider
                value={value}
                min={0}
                max={359}
                step={1}
                onCommit={(v) => commit({ ...map, [k]: v })}
              />
              <span class="theme-hue-preview" style={{ background: `hsl(${value}, 80%, 55%)` }} />
              <button
                type="button"
                class="theme-row-reset"
                title={`Default: ${defaultVal}`}
                aria-label="Reset to default"
                disabled={disabled}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  commit({ ...map, [k]: defaultVal });
                }}
              >
                <RotateCcw class="lucide-icon" />
              </button>
            </span>
          </label>
        );
      })}
    </>
  );
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
