// views/ControlsPane/ResetButton.tsx — Per-row reset icon.
// Disabled when every bound key already equals its registered default;
// click stages a reset (Save still required to commit).

import { RotateCcw } from 'lucide-preact';
import { stageReset } from '@/state/settingsDrafts';
import { useAnyDiffersFromDefault, useDefault } from '@/hooks/useControls';

interface SignalLike {
  get value(): any;
  set value(v: any);
}

function _formatDefaultValue(v: unknown): string {
  if (v === null || v === undefined) return '(none)';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v);
}

export interface ResetButtonProps {
  store: SignalLike;
  /** Keys this row covers. 1 for single widgets; 2 for range-pair. */
  keys: string[];
}

export function ResetButton({ store, keys }: ResetButtonProps) {
  const hasDiff = useAnyDiffersFromDefault(store, keys);
  const def0 = useDefault(store, keys[0] ?? null);
  const def1 = useDefault(store, keys[1] ?? null);
  const title =
    keys.length === 1
      ? `Default: ${_formatDefaultValue(def0)}`
      : keys.length === 2
        ? `Default: ${_formatDefaultValue(def0)} – ${_formatDefaultValue(def1)}`
        : 'Reset to default';

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
