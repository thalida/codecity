// components/fields/TierWidthsField/TierWidthsField.tsx — Renders the STREET_TIERS array
// (FieldKind.TierWidths): one width slider per tier, each with its own per-tier
// reset. The field's value is the whole StreetTier[]; every edit commits a fresh
// array via the draft layer. Dispatched from <Field> for TierWidths-kind fields.

import { useId } from 'preact/hooks';
import { useEffective, useDefault } from '@/hooks/useSettings';
import { setDraft } from '@/state/settings/drafts';
import type { StreetTier } from '@/state/settings/fields/streets';
import { RotateCcw } from 'lucide-preact';
import { SliderField } from '@/components/fields/SliderField/SliderField';
import { FieldRow } from '@/components/fields/FieldRow/FieldRow';
import type { FieldProps } from '@/components/fields/Field/Field';

export function TierWidthsField({ store, fieldKey }: FieldProps) {
  const tiers = useEffective<StreetTier[]>(store, fieldKey) ?? [];
  const defaults = useDefault<StreetTier[]>(store, fieldKey) ?? [];
  const commit = (next: StreetTier[]) => setDraft(store, fieldKey, next);
  const baseId = useId();

  return (
    <>
      {tiers.map((tier, i) => {
        const label = `${tier.min_descendants}+ descendants`;
        const tip = `World-unit width for streets in this descendant-count tier. Above ~256 they overwhelm building footprints; below 1 they disappear.`;
        const defaultWidth = defaults[i]?.width;
        const disabled = tier.width === defaultWidth;
        const descId = `${baseId}-${i}`;
        const controlId = `${baseId}-${i}-c`;
        return (
          <FieldRow
            label={label}
            tip={tip}
            descId={descId}
            htmlFor={controlId}
            key={`tier-${i}`}
            resetSlot={
              <button
                type="button"
                class="setting-row-reset"
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
                <RotateCcw class="icon" />
              </button>
            }
          >
            <SliderField
              value={tier.width}
              min={1}
              max={256}
              step={1}
              describedBy={descId}
              id={controlId}
              onCommit={(v) => {
                const next = tiers.slice();
                next[i] = { ...tiers[i], width: v };
                commit(next);
              }}
            />
          </FieldRow>
        );
      })}
    </>
  );
}
