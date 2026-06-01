// views/panes/controls/CollapsibleSubgroup.tsx — Same visual shell as Subgroup
// but the body is a <details> so users can collapse long lists (e.g.
// per-extension hue rows) or nested groups (Buildings > Facade).
//
// Carries a group-level reset that stages-resets every field under it, shown
// only when `resetKeys` is non-empty and enabled iff one differs from default —
// both computed from the draft layer (no DOM scraping).

import type { ComponentChildren } from 'preact';
import { ChevronRight, RotateCcw } from 'lucide-preact';
import { stageReset } from '@/state/drafts';
import { useAnyResettable, type ResettableRef } from './hooks';

export interface CollapsibleSubgroupProps {
  name: string;
  /** The (store, key) refs of every field under this group. Drives the reset
   *  button; omit to render no group reset. */
  resetKeys?: ResettableRef[];
  children: ComponentChildren;
}

export function CollapsibleSubgroup({ name, resetKeys, children }: CollapsibleSubgroupProps) {
  const keys = resetKeys ?? [];
  const canReset = useAnyResettable(keys);

  // Reset button lives INSIDE <summary> (flex child, margin-left:auto) so it
  // stays visible when the subgroup is collapsed; preventDefault +
  // stopPropagation keep it from toggling the disclosure.
  return (
    <details class="theme-subgroup theme-subgroup-collapsible">
      <summary class="row row--bleed text-label text-label--muted">
        <ChevronRight class="lucide-icon theme-subgroup-chevron" />
        <span class="theme-subgroup-label-text">{name}</span>
        {keys.length > 0 && (
          <button
            type="button"
            class="controls-subgroup-reset"
            title={`Reset all values in ${name} to defaults`}
            aria-label="Reset group to defaults"
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
      {children}
    </details>
  );
}
