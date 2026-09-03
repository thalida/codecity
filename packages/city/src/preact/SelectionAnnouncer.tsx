// preact/SelectionAnnouncer.tsx — the city's selection, spoken. A canvas is a
// graphic: it cannot announce what is picked in it (WCAG 4.1.3), and that is
// true of every host that embeds one, not of any particular app.
import { NodeKind } from '../types/manifest';
import type { PickTarget } from '../types/picker';
import { useCity } from './context';
import { useCitySelection } from './hooks';

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
    default:
      return '';
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
