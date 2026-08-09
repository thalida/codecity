// components/PaneStats.tsx — The stat row pinned to the bottom of a selection
// pane, passed through <Pane footerSlot>. Mirrors <PaneHeader>: one definition
// of the row so the file and road panes read identically.
//
// Items are supplied by the calling pane, which owns the node and therefore
// knows which stats apply. A single row that wraps rather than a grid, so a
// file's five items and a road's four occupy the same shell.

import './PaneStats.css';

export interface PaneStatItem {
  text: string;
  /** Hover tooltip, for a value the short form abbreviates (an exact date). */
  title?: string;
}

export interface PaneStatsProps {
  items: PaneStatItem[];
}

export function PaneStats({ items }: PaneStatsProps) {
  if (items.length === 0) return null;
  return (
    <div class="pane-stats">
      {items.map((item, i) => (
        <>
          {i > 0 && <span class="pane-stats-sep">·</span>}
          <span key={i} class="pane-stats-item" title={item.title ?? ''}>
            {item.text}
          </span>
        </>
      ))}
    </div>
  );
}
