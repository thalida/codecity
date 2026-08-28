// views/CityView/chrome/CityStage/SelectionChip/SelectionChip.tsx — what's selected, while its pane
// is closed. Nothing else on screen says so, and Esc is invisible on a desktop
// and absent on a phone.

import './SelectionChip.css';
import { PanelRightOpen, X } from 'lucide-preact';
import { useComputed } from '@preact/signals';
import { SCENE_HANDLE, clearSelection } from '@/state/stores/city';
import { SELECTION_PANE_DISMISSED, openSelectionPane } from '@/state/stores/chrome';
import { KindBadge } from '@/components/nodes/KindBadge/KindBadge';
import { NodeKind } from '@/city/types/manifest';

/** What the chip names: the node's own label, plus the kind badge its pane
 *  header would have carried. */
interface ChipSelection {
  label: string;
  kind: NodeKind;
  extension?: string | null;
}

/** The selected node as the chip shows it, or null when nothing is selected. */
function useChipSelection() {
  return useComputed<ChipSelection | null>(() => {
    const sel = SCENE_HANDLE.value?.picker.selection.value ?? null;
    if (sel?.kind === NodeKind.File)
      return { label: sel.file.name, kind: NodeKind.File, extension: sel.file.extension };
    if (sel?.kind === NodeKind.Directory) return { label: sel.dir.name, kind: NodeKind.Directory };
    if (sel?.kind === NodeKind.Commit)
      return { label: sel.commit.sha.slice(0, 7), kind: NodeKind.Commit };
    return null;
  });
}

export function SelectionChip() {
  const selection = useChipSelection();
  // Only in the state the pane leaves behind: something selected, details put
  // away. With the pane open it would name what the pane already titles.
  const dismissed = useComputed(() => selection.value !== null && SELECTION_PANE_DISMISSED.value);
  if (!dismissed.value) return null;

  const { label, kind, extension } = selection.value as ChipSelection;

  return (
    <div class="selection-chip surface-glass">
      <button
        type="button"
        class="selection-chip-clear"
        title="Clear selection"
        aria-label={`Clear selection: ${label}`}
        onClick={clearSelection}
      >
        <X class="icon" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="selection-chip-label"
        title="Show details"
        onClick={openSelectionPane}
      >
        <KindBadge kind={kind} extension={extension} />
        <span class="selection-chip-name">{label}</span>
        {/* The inverse of the header button that put the panel away, so the way
            back is drawn as the move it undoes. */}
        <PanelRightOpen class="icon selection-chip-reopen" aria-hidden="true" />
      </button>
    </div>
  );
}
