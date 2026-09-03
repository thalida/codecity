// features/settings/components/HueMapField/HueMapField.tsx — Renders a { key: hue } map (FieldKind.HueMap):
// one 0–359° hue slider per key with a swatch preview + per-key reset. The
// field's value is the whole object; every edit commits a fresh merged object
// via the draft layer. Dispatched from <Field> for HueMap-kind fields.

import './HueMapField.css';
import { useId } from 'preact/hooks';
import { useEffective, useDefault } from '@/hooks/useSettings';
import { setDraft } from '@/features/settings/state/drafts';
import { RotateCcw } from 'lucide-preact';
import { SliderField } from '@/features/settings/components/SliderField/SliderField';
import { FieldRow } from '@/features/settings/components/FieldRow/FieldRow';
import { fileTagHsl } from '@/utils/colors';
import type { FieldProps } from '@/features/settings/components/Field/Field';

export function HueMapField({ store, fieldKey }: FieldProps) {
  const map = useEffective<Record<string, number>>(store, fieldKey) ?? {};
  const defaults = useDefault<Record<string, number>>(store, fieldKey) ?? {};
  const commit = (next: Record<string, number>) => setDraft(store, fieldKey, next);
  const baseId = useId();

  return (
    <>
      {Object.keys(map)
        .sort()
        .map((k) => {
          const value = map[k];
          const defaultVal = defaults[k];
          const disabled = value === defaultVal;
          const tip = `Hue (0 to 359 degrees) for files with this extension.`;
          const descId = `${baseId}-${k}`;
          const controlId = `${baseId}-${k}-c`;
          return (
            <FieldRow
              label={k}
              tip={tip}
              descId={descId}
              htmlFor={controlId}
              key={k}
              resetSlot={
                <button
                  type="button"
                  class="setting-row-reset"
                  title={`Default: ${defaultVal}`}
                  aria-label="Reset to default"
                  disabled={disabled}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    commit({ ...map, [k]: defaultVal });
                  }}
                >
                  <RotateCcw class="icon" />
                </button>
              }
            >
              <SliderField
                value={value}
                min={0}
                max={359}
                step={1}
                describedBy={descId}
                id={controlId}
                onCommit={(v) => commit({ ...map, [k]: v })}
              />
              <span class="setting-hue-preview" style={{ background: fileTagHsl(value) }} />
            </FieldRow>
          );
        })}
    </>
  );
}
