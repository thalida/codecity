// views/panes/controls/CollapsibleSubgroup.tsx — Same visual shell as
// Subgroup but body is a <details> so users can collapse long lists
// (e.g. per-extension hue rows) or nested groups (Buildings > Facade).
//
// Carries a group-level reset that stages-resets every descendant row.
// Identical pattern to Section's reset (queries `.theme-row-reset`
// descendants, delegates click). Hidden when no descendant has a reset.

import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { LucideIcon } from '@/views/components/LucideIcon';
import { useHasAnyResettableRow } from './hooks';

export interface CollapsibleSubgroupProps {
  name: string;
  children: ComponentChildren;
}

export function CollapsibleSubgroup({ name, children }: CollapsibleSubgroupProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const { hasResettable, canReset } = useHasAnyResettableRow(ref);

  return (
    <details ref={ref} class="theme-subgroup theme-subgroup-collapsible">
      <summary class="row row--bleed text-label text-label--muted">
        <LucideIcon name="chevron-right" class="theme-subgroup-chevron" />
        <span class="theme-subgroup-label-text">{name}</span>
        {/* Always rendered so callers can find the button structurally;
            hidden via display:none when the subgroup has no resettable
            rows (e.g. the shortcuts list). */}
        <button
          type="button"
          class="controls-subgroup-reset"
          title={`Reset all values in ${name} to defaults`}
          aria-label="Reset group to defaults"
          disabled={!hasResettable || !canReset}
          style={hasResettable ? undefined : { display: 'none' }}
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
      {children}
    </details>
  );
}
