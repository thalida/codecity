// components/SelectionChip/SelectionChip.tsx — what's selected, while its pane
// is closed. Nothing else on screen says so, and Esc is invisible on a desktop
// and absent on a phone.

import './SelectionChip.css';
import { X } from 'lucide-preact';
import { useComputed } from '@preact/signals';
import { NodeKind } from '@/types';
import { SCENE_HANDLE, clearSelection } from '@/state/stores/scene';
import { SELECTION_PANE_DISMISSED, openSelectionPane } from '@/state/stores/ui';
import { ExtensionBadge } from '@/components/Badge/Badge';

/** What the chip names: the node's own label, plus the extension/dir badge the
 *  pane header would have carried. Commits get no badge, same as their pane. */
interface ChipSelection {
  label: string;
  badge: { extension?: string; isDir: boolean } | null;
}

/** The selected node as the chip shows it, or null when nothing is selected. */
function useChipSelection() {
  return useComputed<ChipSelection | null>(() => {
    const sel = SCENE_HANDLE.value?.picker.selection.value ?? null;
    if (sel?.kind === NodeKind.File)
      return { label: sel.file.name, badge: { extension: sel.file.extension, isDir: false } };
    if (sel?.kind === NodeKind.Directory) return { label: sel.dir.name, badge: { isDir: true } };
    if (sel?.kind === NodeKind.Commit) return { label: sel.commit.sha.slice(0, 7), badge: null };
    return null;
  });
}

export function SelectionChip() {
  const selection = useChipSelection();
  // Only in the state the pane leaves behind: something selected, details put
  // away. With the pane open it would name what the pane already titles.
  const dismissed = useComputed(() => selection.value !== null && SELECTION_PANE_DISMISSED.value);
  if (!dismissed.value) return null;

  const { label, badge } = selection.value as ChipSelection;

  return (
    <div class="selection-chip surface-glass">
      <button
        type="button"
        class="selection-chip-label"
        title="Show details"
        onClick={openSelectionPane}
      >
        {badge && <ExtensionBadge extension={badge.extension ?? null} isDir={badge.isDir} />}
        <span class="selection-chip-name">{label}</span>
      </button>
      <button
        type="button"
        class="selection-chip-clear"
        title="Clear selection"
        aria-label={`Clear selection: ${label}`}
        onClick={clearSelection}
      >
        <X class="icon" aria-hidden="true" />
      </button>
    </div>
  );
}
