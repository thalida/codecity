// components/SelectionChip/SelectionChip.tsx — what's selected, while its pane
// is closed. Nothing else on screen says so, and Esc is invisible on a desktop
// and absent on a phone.

import './SelectionChip.css';
import { X } from 'lucide-preact';
import { useComputed } from '@preact/signals';
import { NodeKind } from '@/types';
import { SCENE_HANDLE, clearSelection } from '@/state/stores/scene';
import { SELECTION_PANE_DISMISSED, openSelectionPane } from '@/state/stores/ui';

/** Name of the selected node, or null when nothing is selected. */
function useSelectionLabel() {
  return useComputed(() => {
    const sel = SCENE_HANDLE.value?.picker.selection.value ?? null;
    if (sel?.kind === NodeKind.File) return sel.file.name;
    if (sel?.kind === NodeKind.Directory) return sel.dir.name;
    if (sel?.kind === NodeKind.Commit) return sel.commit.sha.slice(0, 7);
    return null;
  });
}

export function SelectionChip() {
  const label = useSelectionLabel();
  // Only in the state the pane leaves behind: something selected, details put
  // away. With the pane open it would name what the pane already titles.
  const dismissed = useComputed(() => label.value !== null && SELECTION_PANE_DISMISSED.value);
  if (!dismissed.value) return null;

  return (
    <div class="selection-chip surface-glass">
      <button
        type="button"
        class="selection-chip-label"
        title="Show details"
        onClick={openSelectionPane}
      >
        {label.value}
      </button>
      <button
        type="button"
        class="selection-chip-clear"
        title="Clear selection"
        aria-label={`Clear selection: ${label.value}`}
        onClick={clearSelection}
      >
        <X class="icon" aria-hidden="true" />
      </button>
    </div>
  );
}
