// The single owner of document.title, named after the city on screen.
//
// No in-progress state: a load in flight is the overlay's business, and a
// pending label stranded the tab at "(pending)" when entering Timeline set one.

import { useEffect } from 'preact/hooks';
import { useCityManifest } from '@codecity/city/preact';

export function useDocumentTitle(): void {
  // tree.name is the server-normalized display name (owner/repo or basename).
  const label = useCityManifest()?.tree?.name ?? '';
  useEffect(() => {
    document.title = label ? `${label} — codecity` : 'codecity';
    // Leaving the route leaves no city to be named after.
    return () => void (document.title = 'codecity');
  }, [label]);
}
