// components/Subgroup.tsx — A labeled group of control rows.
//
// Collapsible by default: a <details> with a chevron + a group-level reset that
// stages every field beneath it back to its default (shown only when resetKeys
// is non-empty, enabled iff one differs from default — draft-driven, no DOM
// scraping). Pass collapsible={false} for a plain always-open group with no
// reset (e.g. a small cluster like "Stars", or the Live-updates pair).

import type { ComponentChildren } from 'preact';
import { ChevronRight, RotateCcw } from 'lucide-preact';
import { stageReset } from '@/state/settingsDrafts';
import { useAnyResettable, type ResettableRef } from '@/hooks/useSettings';

export interface SubgroupProps {
  name: string;
  /** Collapsible (a <details> with a group reset) by default; false renders a
   *  plain always-open labeled group with no reset. */
  collapsible?: boolean;
  /** The (store, key) refs of every field under this group — drives the group
   *  reset button. Only meaningful for collapsible groups; omit for no reset. */
  resetKeys?: ResettableRef[];
  children: ComponentChildren;
}

export function Subgroup({ name, collapsible = true, resetKeys, children }: SubgroupProps) {
  const keys = resetKeys ?? [];
  // Called unconditionally (before the branch) to satisfy rules-of-hooks; with
  // no keys it's a cheap no-op that just returns false.
  const canReset = useAnyResettable(keys);

  if (!collapsible) {
    return (
      <div class="theme-subgroup">
        <div class="text-label text-label--muted">{name}</div>
        {children}
      </div>
    );
  }

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
