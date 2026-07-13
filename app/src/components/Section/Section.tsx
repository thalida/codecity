// components/Section.tsx — Top-level collapsible section in the
// settings panel. Header row contains the section name plus a reset icon that
// stages-resets every field in the section. The section reset is shown only
// when the section has resettable fields (`resetKeys`) and enabled iff at least
// one of them differs from its default — both computed from the draft layer (no
// DOM scraping). Clicking stages a reset for each field; Save still applies.
//
// Open/closed state is intentionally NOT persisted: the left sidebar resets
// every <details> to closed when the Controls tab becomes visible.

import './Section.css';
import { type ComponentChildren } from 'preact';
import { useSignal } from '@preact/signals';
import { ChevronRight, RotateCcw } from 'lucide-preact';
import { stageReset } from '@/state/settingsDrafts';
import { useAnyResettable, type ResettableRef } from '@/hooks/useSettings';

export interface SectionProps {
  name: string;
  hint?: string;
  /** The (store, key) refs of every field under this section. Drives the
   *  header reset button; omit (bespoke sections) to render no section reset. */
  resetKeys?: ResettableRef[];
  children: ComponentChildren;
}

export function Section({ name, hint, resetKeys, children }: SectionProps) {
  const keys = resetKeys ?? [];
  const canReset = useAnyResettable(keys);
  const open = useSignal(false);

  // A disclosure, NOT a <details>: the header is a flex row with a real
  // aria-expanded toggle button and the reset button as SIBLINGS. (An
  // interactive control nested inside <summary> is unreliable for keyboard/AT.)
  // The body stays a direct child so structural CSS is unchanged; .is-open
  // hides it when collapsed.
  return (
    <div class={open.value ? 'controls-section is-open' : 'controls-section'}>
      <div class="row row--bleed controls-section-summary">
        <button
          type="button"
          class="controls-disclosure-toggle"
          aria-expanded={open.value}
          onClick={() => {
            open.value = !open.value;
          }}
        >
          <ChevronRight class="lucide-icon chevron" />
          <span class="text-label">{name}</span>
        </button>
        {keys.length > 0 && (
          <button
            type="button"
            class="controls-section-reset"
            title="Reset all values in this section to defaults"
            aria-label="Reset section to defaults"
            disabled={!canReset}
            onClick={() => {
              for (const r of keys) stageReset(r.store, r.key);
            }}
          >
            <RotateCcw class="lucide-icon" />
          </button>
        )}
      </div>
      {hint && <div class="controls-section-hint">{hint}</div>}
      {children}
    </div>
  );
}
