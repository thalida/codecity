// components/SelectionAnnouncer/SelectionAnnouncer.tsx — a visually-hidden live
// region that speaks the current city selection to screen readers. The canvas
// is a graphic and can't announce its own selection, so App mounts one of these
// and it mirrors the picker: whenever the selected building/street/tree/gem
// changes, the new selection is announced (WCAG 4.1.3 Status Messages).

import { useComputed } from '@preact/signals';
import { SCENE_HANDLE } from '@/state/stores/scene';
import { NodeKind } from '@/types';
import type { PickTarget } from '@/types';

function describe(sel: PickTarget | null): string {
  if (!sel) return '';
  switch (sel.kind) {
    case NodeKind.File:
      return `Selected file: ${sel.file.path ?? sel.file.name}`;
    case NodeKind.Directory:
      return `Selected directory: ${sel.dir.path ?? sel.dir.name}`;
    case NodeKind.Commit:
      return `Selected commit ${sel.commit.sha.slice(0, 7)}, ${sel.commit.subject}`;
    case NodeKind.Gem:
      return 'Selected the repository';
  }
}

export function SelectionAnnouncer() {
  // Recomputes on every SCENE_HANDLE swap and picker-selection change. An equal
  // string is deduped by the computed, so re-resolving the same selection across
  // a rebuild doesn't re-announce.
  const message = useComputed(() => {
    const handle = SCENE_HANDLE.value;
    return handle ? describe(handle.picker.selection.value) : '';
  });
  return (
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message.value}
    </div>
  );
}
