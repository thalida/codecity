// The single owner of document.title: it names the focused project.
//
// No in-progress state: PENDING_SOURCE_LABEL is set by entering Timeline too,
// so a stale one stranded the tab at "(pending)". The overlay still shows it.

import { useSignalEffect } from '@preact/signals';
import { useProject } from '@/state/project/context';

export function useDocumentTitle(): void {
  const { manifest } = useProject();
  useSignalEffect(() => {
    const m = manifest.current.value;
    // tree.name is the server-normalized display name (owner/repo or basename).
    const label = (m as { tree?: { name?: string } } | null)?.tree?.name ?? '';
    document.title = label ? `${label} — codecity` : 'codecity';
  });
}
