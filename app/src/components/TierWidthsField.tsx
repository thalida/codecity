// components/TierWidthsField.tsx — Renders the STREET_TIERS array
// (FieldKind.TierWidths): one width slider per tier, each with its own per-tier
// reset. The field's value is the whole StreetTier[]; every edit commits a fresh
// array via the draft layer. Dispatched from <Field> for TierWidths-kind fields.

import { useEffective, useDefault } from '@/hooks/useSettings';
import { setDraft } from '@/state/settingsDrafts';
import type { StreetTier } from '@/state/stores/settings/streets';
import { RotateCcw } from 'lucide-preact';
import { Slider } from '@/components/Slider/Slider';
import type { FieldProps } from './Field';

export function TierWidthsField({ store, fieldKey }: FieldProps) {
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
            <span class="theme-row-label" title={tip}>
              {label}
            </span>
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
