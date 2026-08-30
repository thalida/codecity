// views/CityView/SelectionAnnouncer/SelectionAnnouncer.tsx — a visually-hidden
// live region speaking the city selection to screen readers, since the canvas is
// a graphic and cannot announce its own (WCAG 4.1.3).
import { NodeKind, type PickTarget } from '@codecity/city';
import { useCity, useCitySelection } from '@codecity/city/preact';

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
  const city = useCity();
  const selection = useCitySelection();
  // Nothing to announce before there is a city to select in. Re-resolving the
  // same selection across a rebuild produces the same string, and an unchanged
  const message = city ? describe(selection) : '';
  return (
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
