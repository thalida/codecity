// components/Subgroup.tsx — a labelled group of control rows, collapsible with a
// group-level reset over the fields beneath it. collapsible={false} gives a
// plain always-open cluster with no reset.
import './Subgroup.css';
import type { ComponentChildren } from 'preact';
import { useSignal } from '@preact/signals';
import { ChevronRight, RotateCcw } from 'lucide-preact';
import { stageReset } from '@/state/settings/drafts';
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
  const open = useSignal(false);

  if (!collapsible) {
    return (
      <div class="setting-subgroup">
        <div class="text-label">{name}</div>
        {children}
      </div>
    );
  }

  // A disclosure, not <details>: an interactive control nested in <summary> is
  // unreliable for keyboard and AT, so toggle and reset are siblings.
  return (
    <div
      class={
        open.value
          ? 'setting-subgroup setting-subgroup-collapsible is-open'
          : 'setting-subgroup setting-subgroup-collapsible'
      }
    >
      <div class="row setting-subgroup-summary">
        <button
          type="button"
          class="controls-disclosure-toggle"
          aria-expanded={open.value}
          onClick={() => {
            open.value = !open.value;
          }}
        >
          <ChevronRight class="icon chevron" />
          <span class="setting-subgroup-label-text text-label">{name}</span>
        </button>
        {keys.length > 0 && (
          <button
            type="button"
            class="controls-subgroup-reset"
            title={`Reset all values in ${name} to defaults`}
            aria-label="Reset group to defaults"
            disabled={!canReset}
            onClick={() => {
              for (const r of keys) stageReset(r.store, r.key);
            }}
          >
            <RotateCcw class="icon" />
          </button>
        )}
      </div>
      <div class="controls-disclosure-body">{children}</div>
    </div>
  );
}
