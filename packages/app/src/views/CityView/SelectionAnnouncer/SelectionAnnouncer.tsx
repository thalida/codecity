// views/CityView/SelectionAnnouncer/SelectionAnnouncer.tsx — a visually-hidden
// live region speaking the city selection to screen readers, since the canvas is
// a graphic and cannot announce its own (WCAG 4.1.3).
import { NodeKind, PickTarget } from '@codecity/city';
import { useComputed } from '@preact/signals';
import { CITY_SELECTION, SCENE_HANDLE } from '@/state/stores/city';

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
  // The computed dedupes an equal string, so re-resolving the same selection
  // across a rebuild does not re-announce it.
  const message = useComputed(() => {
    const handle = SCENE_HANDLE.value;
    return handle ? describe(CITY_SELECTION.value) : '';
  });
  return (
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message.value}
    </div>
  );
}
