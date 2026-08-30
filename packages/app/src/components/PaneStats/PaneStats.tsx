// components/PaneStats/PaneStats.tsx — the stat row pinned to the bottom
// of a selection pane. The calling pane supplies the items, since it owns the
// node; one row that wraps rather than a grid, so a file's five and a road's
// four occupy the same shell.
import './PaneStats.css';

export interface PaneStatItem {
  text: string;
  /** Hover tooltip, for a value the short form abbreviates (an exact date).
   *  Defaults to the text, so a truncated item can still be read in full. */
  title?: string;
  /** How readily this item gives up width. Higher yields first; default 1. */
  shrink?: number;
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
          <span
            key={i}
            class="pane-stats-item"
            title={item.title ?? item.text}
            style={{ flexShrink: item.shrink ?? 1 }}
          >
            {item.text}
          </span>
        </>
      ))}
    </div>
  );
}
