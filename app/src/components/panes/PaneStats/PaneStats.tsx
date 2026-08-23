// components/panes/PaneStats/PaneStats.tsx — the stat row pinned to the bottom
// of a selection pane. The calling pane supplies the items, since it owns the
// node; one row that wraps rather than a grid, so a file's five and a road's
// four occupy the same shell.
import './PaneStats.css';
import type { StatItem } from '@/types/ui';

export interface PaneStatsProps {
  items: StatItem[];
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
