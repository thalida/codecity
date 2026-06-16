// components/PaneTabs/PaneTabs.tsx — horizontal segmented tabs rendered inside
// a Pane body (below the header). Controlled + presentational: the parent owns
// the active id and decides what each tab renders. Arrow-key navigable.

import './PaneTabs.css';
import type { LucideIcon } from 'lucide-preact';

export interface PaneTab {
  id: string;
  label: string;
  icon?: LucideIcon;
}

export interface PaneTabsProps {
  tabs: PaneTab[];
  active: string;
  onSelect: (id: string) => void;
}

export function PaneTabs({ tabs, active, onSelect }: PaneTabsProps) {
  const move = (dir: 1 | -1) => {
    const i = tabs.findIndex((t) => t.id === active);
    if (i < 0) return;
    const next = (i + dir + tabs.length) % tabs.length;
    onSelect(tabs[next].id);
  };
  return (
    <div class="pane-tabs" role="tablist">
      {tabs.map((t) => {
        const Icon = t.icon;
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected ? 'true' : 'false'}
            class={selected ? 'pane-tab pane-tab--active' : 'pane-tab'}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                move(1);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                move(-1);
              }
            }}
          >
            {Icon && <Icon class="lucide-icon" aria-hidden="true" />}
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
