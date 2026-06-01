// components/ResetButton.tsx — Per-row reset icon.
// Disabled when every bound key already equals its registered default;
// click stages a reset (Save still required to commit).

import { RotateCcw } from 'lucide-preact';
import { stageReset } from '@/state/settingsDrafts';
import { getDefault } from '@/state/persist';
import { useAnyDiffersFromDefault } from '@/hooks/useSettings';

interface SignalLike {
  get value(): any;
  set value(v: any);
}

function _formatDefaultValue(v: unknown): string {
  if (v === null || v === undefined) return '(none)';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v);
}

/** Default title: "Default: a – b – …" over however many keys the row covers,
 *  or "Reset to default" when there's nothing to show. Scales to any key count
 *  — no per-arity special-casing. */
function _defaultTitle(defaults: unknown[]): string {
  if (defaults.length === 0) return 'Reset to default';
  return `Default: ${defaults.map(_formatDefaultValue).join(' – ')}`;
}

export interface ResetButtonProps {
  store: SignalLike;
  /** Keys this row covers — one for single widgets, two for range-pair, any
   *  number for multi-value rows. */
  keys: string[];
  /** Override the hover title. Receives each key's registered default in
   *  `keys` order. Defaults to {@link _defaultTitle}. */
  formatTitle?: (defaults: unknown[]) => string;
}

export function ResetButton({ store, keys, formatTitle = _defaultTitle }: ResetButtonProps) {
  const hasDiff = useAnyDiffersFromDefault(store, keys);
  // getDefault is a static read (no subscription), so mapping over keys is
  // safe here — unlike a use*() hook, it isn't subject to rules-of-hooks.
  const defaults = keys.map((k) => getDefault(store, k));
  const title = formatTitle(defaults);

  return (
    <button
      type="button"
      class="theme-row-reset"
      title={title}
      aria-label="Reset to default"
      disabled={!hasDiff}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        for (const k of keys) stageReset(store, k);
      }}
    >
      <RotateCcw class="lucide-icon" />
    </button>
  );
}
