// components/settings/Section/Section.tsx — a collapsible settings section, with a header reset
// that stages a reset for every field under it. Open state is deliberately not
// persisted: the sidebar closes them all when the Controls tab appears.
import './Section.css';
import { type ComponentChildren } from 'preact';
import { useSignal } from '@preact/signals';
import { ChevronRight, RotateCcw } from 'lucide-preact';
import { stageReset } from '@/state/settings/drafts';
import { useAnyResettable, type ResettableRef } from '@/hooks/useSettings';

export interface SectionProps {
  name: string;
  /** Sub-header helper text. A string for the common case; rich content (e.g. a
   *  hint with a link) is fine too. */
  hint?: ComponentChildren;
  /** The (store, key) refs of every field under this section. Drives the
   *  header reset button; omit (bespoke sections) to render no section reset. */
  resetKeys?: ResettableRef[];
  /** Reset for sections outside the draft system (the excludes list). Takes
   *  precedence over `resetKeys`. */
  onReset?: () => void;
  resetEnabled?: boolean;
  /** Tooltip + aria-label for the reset button when the default draft-reset copy
   *  ("...values...to defaults") doesn't fit the section. */
  resetTitle?: string;
  /** Start expanded instead of collapsed (e.g. the Scan/Appearance tabs, where a
   *  section or two reads better open). Defaults to collapsed. */
  defaultOpen?: boolean;
  children: ComponentChildren;
}

export function Section({
  name,
  hint,
  resetKeys,
  onReset,
  resetEnabled,
  resetTitle,
  defaultOpen,
  children,
}: SectionProps) {
  const keys = resetKeys ?? [];
  const keysResettable = useAnyResettable(keys);
  const customReset = typeof onReset === 'function';
  const showReset = customReset || keys.length > 0;
  const canReset = customReset ? !!resetEnabled : keysResettable;
  const open = useSignal(defaultOpen ?? false);
  // A collapsed body is display:none, so mounting it costs ~150 hidden controls
  // per World-tab open. Mount on first open; stay mounted so reopening is free.
  const everOpened = useSignal(defaultOpen ?? false);

  // A disclosure, not <details>: an interactive control nested in <summary> is
  // unreliable for keyboard and AT, so toggle and reset are siblings.
  return (
    <div class={open.value ? 'controls-section is-open' : 'controls-section'}>
      <div class="row controls-section-summary">
        <button
          type="button"
          class="controls-disclosure-toggle"
          aria-expanded={open.value}
          onClick={() => {
            open.value = !open.value;
            if (open.value) everOpened.value = true;
          }}
        >
          <ChevronRight class="icon chevron" />
          <span class="text-label">{name}</span>
        </button>
        {showReset && (
          <button
            type="button"
            class="controls-section-reset"
            title={resetTitle ?? 'Reset all values in this section to defaults'}
            aria-label={resetTitle ?? 'Reset section to defaults'}
            disabled={!canReset}
            onClick={() => {
              if (customReset) {
                onReset!();
                return;
              }
              for (const r of keys) stageReset(r.store, r.key);
            }}
          >
            <RotateCcw class="icon" />
          </button>
        )}
      </div>
      <div class="controls-disclosure-body">
        {everOpened.value && (
          <>
            {hint && <div class="controls-section-hint">{hint}</div>}
            {children}
          </>
        )}
      </div>
    </div>
  );
}
