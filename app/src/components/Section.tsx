// views/ControlsPane/Section.tsx — Top-level collapsible section in the
// settings panel. Header row contains the section name plus a reset icon that
// stages-resets every field in the section. The section reset is shown only
// when the section has resettable fields (`resetKeys`) and enabled iff at least
// one of them differs from its default — both computed from the draft layer (no
// DOM scraping). Clicking stages a reset for each field; Save still applies.
//
// Open/closed state is intentionally NOT persisted: the left sidebar resets
// every <details> to closed when the Controls tab becomes visible.

import { type ComponentChildren } from 'preact';
import { ChevronRight, RotateCcw } from 'lucide-preact';
import { stageReset } from '@/state/drafts';
import { useAnyResettable, type ResettableRef } from '@/hooks/useControls';

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

  // Reset button lives INSIDE <summary> (flex child, margin-left:auto) so it
  // stays visible when the section is collapsed — a closed <details> hides
  // its non-summary children. preventDefault + stopPropagation on click keep
  // it from toggling the disclosure.
  return (
    <details class="controls-section">
      <summary class="row row--bleed controls-section-summary">
        <ChevronRight class="lucide-icon controls-section-chevron" />
        <span class="text-label">{name}</span>
        {keys.length > 0 && (
          <button
            type="button"
            class="controls-section-reset"
            title="Reset all values in this section to defaults"
            aria-label="Reset section to defaults"
            disabled={!canReset}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              for (const r of keys) stageReset(r.store, r.key);
            }}
          >
            <RotateCcw class="lucide-icon" />
          </button>
        )}
      </summary>
      {hint && <div class="controls-section-hint">{hint}</div>}
      {children}
    </details>
  );
}
