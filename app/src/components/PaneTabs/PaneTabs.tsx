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
  /** Extra class on the strip root for context-specific spacing (e.g. modal). */
  class?: string;
}

export function PaneTabs({ tabs, active, onSelect, class: className }: PaneTabsProps) {
  return (
    <div class={className ? `pane-tabs ${className}` : 'pane-tabs'} role="tablist">
      {tabs.map((t) => {
        const Icon = t.icon;
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected ? 'true' : 'false'}
            class={selected ? 'pane-tab pane-tab--active focus-inset' : 'pane-tab focus-inset'}
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
