// components/HueMapField.tsx — Renders a { key: hue } map (FieldKind.HueMap):
// one 0–359° hue slider per key with a swatch preview + per-key reset. The
// field's value is the whole object; every edit commits a fresh merged object
// via the draft layer. Dispatched from <Field> for HueMap-kind fields.

import { useEffective, useDefault } from '@/hooks/useSettings';
import { setDraft } from '@/state/settingsDrafts';
import { RotateCcw } from 'lucide-preact';
import { Slider } from '@/components/Slider';
import type { FieldProps } from './Field';

export function HueMapField({ store, fieldKey }: FieldProps) {
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
