// Shared frosted scrub toast ("this is HEAD, not the timeline commit"). Absolutely
// positioned — the host must be position:relative and clear it (has-stale-note pad).

import './TimelineStaleNote.css';
import type { ComponentChildren } from 'preact';
import { TriangleAlert } from 'lucide-preact';

export function TimelineStaleNote({ children }: { children: ComponentChildren }) {
  return (
    <div class="timeline-stale-note" role="alert">
      <TriangleAlert class="icon" aria-hidden="true" />
      {children}
    </div>
  );
}
