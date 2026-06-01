// views/panes/controls/Fields.tsx — Draft-aware field wrappers used by the
// settings panel. Each wraps a generic input (in views/components/) with a
// Row (label + reset button) and binds reads/writes to the draft layer:
//   read:  useEffective(store, key)
//   write: setDraft(store, key, v) on user input
//
// Variants:
//   ColorField, NumberField, SliderField, ToggleField, SelectField,
//   RangePairField  — single-key fields on a flat signal.
//   NestedSliderField — slider bound to store.value[parentKey][subKey];
//                       writes merge other sub-keys back in.
//   TierWidthSliderField — special-case for STREET_TIERS, which is an
//                          array of { min_descendants, width } objects.

import { setDraft } from '@/state/drafts';
import { STREET_TIERS } from '@/state/settings/index';
import { ColorInput } from '@/views/components/ColorInput';
import { NumberInput } from '@/views/components/NumberInput';
import { Slider } from '@/views/components/Slider';
import { Toggle } from '@/views/components/Toggle';
import { SegmentedSelect } from '@/views/components/SegmentedSelect';
import type { SegmentedSelectOption } from '@/views/components/SegmentedSelect';
import { RangePair } from '@/views/components/RangePair';
import { RotateCcw } from 'lucide-preact';
import { Row } from './Row';
import { useEffective, useDefault } from './hooks';

interface SignalLike {
  get value(): any;
  set value(v: any);
}

export interface FieldOpts {
  tip?: string;
}

// ── Single-key fields ─────────────────────────────────────────────────

export interface ColorFieldProps extends FieldOpts {
  label: string;
  store: SignalLike;
  fieldKey: string;
}

export function ColorField({ label, store, fieldKey, tip }: ColorFieldProps) {
  const value = useEffective<string>(store, fieldKey);
  return (
    <Row label={label} tip={tip} store={store} keys={[fieldKey]}>
      <ColorInput value={value} onCommit={(v) => setDraft(store, fieldKey, v)} />
    </Row>
  );
}

export interface NumberFieldProps extends FieldOpts {
  label: string;
  store: SignalLike;
  fieldKey: string;
  min: number;
  max: number;
  step: number;
}

export function NumberField({ label, store, fieldKey, min, max, step, tip }: NumberFieldProps) {
  const value = useEffective<number>(store, fieldKey);
  return (
    <Row label={label} tip={tip} store={store} keys={[fieldKey]}>
      <NumberInput
        value={value}
        min={min}
        max={max}
        step={step}
        onCommit={(v) => setDraft(store, fieldKey, v)}
      />
    </Row>
  );
}

export interface SliderFieldProps extends FieldOpts {
  label: string;
  store: SignalLike;
  fieldKey: string;
  min: number;
  max: number;
  step: number;
}

export function SliderField({ label, store, fieldKey, min, max, step, tip }: SliderFieldProps) {
  const value = useEffective<number>(store, fieldKey);
  return (
    <Row label={label} tip={tip} store={store} keys={[fieldKey]}>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onCommit={(v) => setDraft(store, fieldKey, v)}
      />
    </Row>
  );
}

export interface ToggleFieldProps extends FieldOpts {
  label: string;
  store: SignalLike;
  fieldKey: string;
}

export function ToggleField({ label, store, fieldKey, tip }: ToggleFieldProps) {
  const value = useEffective<boolean>(store, fieldKey);
  return (
    <Row label={label} tip={tip} store={store} keys={[fieldKey]}>
      <Toggle checked={!!value} onCommit={(v) => setDraft(store, fieldKey, v)} />
    </Row>
  );
}

export interface SelectFieldProps extends FieldOpts {
  label: string;
  store: SignalLike;
  fieldKey: string;
  options: SegmentedSelectOption[];
}

export function SelectField({ label, store, fieldKey, options, tip }: SelectFieldProps) {
  const value = useEffective<string>(store, fieldKey);
  return (
    <Row label={label} tip={tip} store={store} keys={[fieldKey]}>
      <SegmentedSelect
        value={value}
        options={options}
        onCommit={(v) => setDraft(store, fieldKey, v)}
      />
    </Row>
  );
}

export interface RangePairFieldProps extends FieldOpts {
  label: string;
  store: SignalLike;
  minKey: string;
  maxKey: string;
  min: number;
  max: number;
  step: number;
}

export function RangePairField({
  label,
  store,
  minKey,
  maxKey,
  min,
  max,
  step,
  tip,
}: RangePairFieldProps) {
  const lo = useEffective<number>(store, minKey);
  const hi = useEffective<number>(store, maxKey);
  return (
    <Row label={label} tip={tip} store={store} keys={[minKey, maxKey]}>
      <RangePair
        lo={lo}
        hi={hi}
        min={min}
        max={max}
        step={step}
        onCommit={(l, h) => {
          setDraft(store, minKey, l);
          setDraft(store, maxKey, h);
        }}
      />
    </Row>
  );
}

// ── Nested-key fields ─────────────────────────────────────────────────

export interface NestedSliderFieldProps extends FieldOpts {
  label: string;
  store: SignalLike;
  parentKey: string;
  subKey: string;
  min: number;
  max: number;
  step: number;
  /** If true, appends a small HSL swatch preview next to the slider. */
  previewHue?: boolean;
}

function _formatDefaultValue(v: unknown): string {
  if (v === null || v === undefined) return '(none)';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v);
}

function NestedResetButton({
  store,
  parentKey,
  subKey,
}: {
  store: SignalLike;
  parentKey: string;
  subKey: string;
}) {
  const defaultMap = useDefault<Record<string, unknown>>(store, parentKey) || {};
  const defaultVal = defaultMap[subKey];
  const currentMap = useEffective<Record<string, unknown>>(store, parentKey) || {};
  const currentVal = currentMap[subKey];
  const disabled = JSON.stringify(currentVal) === JSON.stringify(defaultVal);

  return (
    <button
      type="button"
      class="theme-row-reset"
      title={`Default: ${_formatDefaultValue(defaultVal)}`}
      aria-label="Reset to default"
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const merged = { ...currentMap, [subKey]: defaultVal };
        setDraft(store, parentKey, merged);
      }}
    >
      <RotateCcw class="lucide-icon" />
    </button>
  );
}

export function NestedSliderField({
  label,
  store,
  parentKey,
  subKey,
  min,
  max,
  step,
  tip,
  previewHue,
}: NestedSliderFieldProps) {
  const map = useEffective<Record<string, number>>(store, parentKey) || {};
  const value = map[subKey];
  const fullTip = tip ? `${label} — ${tip}` : label;

  return (
    <label class="theme-row" title={fullTip}>
      <span class="theme-row-label" title={fullTip}>{label}</span>
      <span class="theme-row-control">
        <Slider
          value={value}
          min={min}
          max={max}
          step={step}
          onCommit={(v) => {
            const merged = { ...map, [subKey]: v };
            setDraft(store, parentKey, merged);
          }}
        />
        {previewHue && (
          <span
            class="theme-hue-preview"
            style={{ background: `hsl(${value}, 80%, 55%)` }}
          />
        )}
        <NestedResetButton store={store} parentKey={parentKey} subKey={subKey} />
      </span>
    </label>
  );
}

// ── Tier-width slider (STREET_TIERS array) ────────────────────────────

function TierWidthResetButton({ index }: { index: number }) {
  const defaultArr = useDefault<Array<{ min_descendants: number; width: number }>>(
    STREET_TIERS,
    null
  ) as unknown as Array<{ min_descendants: number; width: number }> | undefined;
  const defaultVal = (defaultArr ?? [])[index]?.width;
  const currentArr = useEffective<Array<{ min_descendants: number; width: number }>>(
    STREET_TIERS,
    null
  ) as unknown as Array<{ min_descendants: number; width: number }>;
  const currentVal = (currentArr ?? [])[index]?.width;
  const disabled = currentVal === defaultVal;

  return (
    <button
      type="button"
      class="theme-row-reset"
      title={`Default: ${_formatDefaultValue(defaultVal)}`}
      aria-label="Reset to default"
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = currentArr.slice();
        next[index] = { min_descendants: currentArr[index].min_descendants, width: defaultVal };
        setDraft(STREET_TIERS, null, next);
      }}
    >
      <RotateCcw class="lucide-icon" />
    </button>
  );
}

export interface TierWidthSliderFieldProps {
  index: number;
  minDescendants: number;
}

export function TierWidthSliderField({ index, minDescendants }: TierWidthSliderFieldProps) {
  const arr = useEffective<Array<{ min_descendants: number; width: number }>>(
    STREET_TIERS,
    null
  ) as unknown as Array<{ min_descendants: number; width: number }>;
  const value = (arr ?? [])[index]?.width;
  const label = `${minDescendants}+ descendants`;
  const tip =
    'World-unit width for streets in this descendant-count tier. Above ~256 streets overwhelm building footprints; below 1 they disappear.';
  const fullTip = `${label} — ${tip}`;

  return (
    <label class="theme-row" title={fullTip}>
      <span class="theme-row-label" title={fullTip}>{label}</span>
      <span class="theme-row-control">
        <Slider
          value={value}
          min={1}
          max={256}
          step={1}
          onCommit={(v) => {
            const next = arr.slice();
            next[index] = { min_descendants: arr[index].min_descendants, width: v };
            setDraft(STREET_TIERS, null, next);
          }}
        />
        <TierWidthResetButton index={index} />
      </span>
    </label>
  );
}

