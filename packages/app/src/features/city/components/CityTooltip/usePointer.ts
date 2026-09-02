// Where the pointer is. A DOM fact the view already has: the city would
// otherwise have to report a position sixty times a second for it.

import { useEffect, useState } from 'preact/hooks';

export function usePointer(): { x: number; y: number } | null {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const track = (e: PointerEvent) => setAt({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', track);
    return () => window.removeEventListener('pointermove', track);
  }, []);
  return at;
}
