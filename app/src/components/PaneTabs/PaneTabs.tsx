// components/PaneTabs/PaneTabs.tsx — horizontal segmented tabs rendered inside
// a Pane body (below the header). Controlled + presentational: the parent owns
// the active id and decides what each tab renders.

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
          >
            {Icon && <Icon class="lucide-icon" aria-hidden="true" />}
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
