// views/panes/controls/Section.tsx — Top-level collapsible section in the
// settings panel. Header row contains the section name plus a reset
// icon that stages-resets EVERY row in the section. Section reset is
// enabled iff at least one descendant row's reset is enabled (i.e., at
// least one row differs from its default). The reset uses the same
// per-row reset buttons as the registry — clicking the section reset
// just delegates to each child reset's click handler.
//
// Open/closed state is intentionally NOT persisted: the left sidebar
// resets every <details> to closed each time the Controls tab becomes
// visible so the panel always opens fresh.

import { type ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { LucideIcon } from '@/views/components/LucideIcon';
import { useHasAnyResettableRow } from './hooks';

export interface SectionProps {
  name: string;
  hint?: string;
  children: ComponentChildren;
}

export function Section({ name, hint, children }: SectionProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const sectionState = useHasAnyResettableRow(ref);

  return (
    <details ref={ref} class="controls-section">
      <summary class="row row--bleed controls-section-summary">
        <LucideIcon name="chevron-right" class="controls-section-chevron" />
        <span class="text-label">{name}</span>
        {/* Always rendered; hidden via display:none when this section
            has no resettable rows (e.g. Keyboard & mouse, Debug). */}
        <button
          type="button"
          class="controls-section-reset"
          title="Reset all values in this section to defaults"
          aria-label="Reset section to defaults"
          disabled={!sectionState.hasResettable || !sectionState.canReset}
          style={sectionState.hasResettable ? undefined : { display: 'none' }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!ref.current) return;
            ref.current
              .querySelectorAll<HTMLButtonElement>('.theme-row-reset')
              .forEach((b) => {
                if (!b.disabled) b.click();
              });
          }}
        >
          <LucideIcon name="rotate-ccw" />
        </button>
      </summary>
      {hint && <div class="controls-section-hint">{hint}</div>}
      {children}
    </details>
  );
}
