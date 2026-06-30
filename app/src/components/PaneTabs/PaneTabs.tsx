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
  idPrefix?: string;
  /** Extra class on the strip root for context-specific spacing (e.g. modal). */
  class?: string;
}

export function paneTabId(idPrefix: string, tabId: string) {
  return `${idPrefix}-${tabId}-tab`;
}

export function panePanelId(idPrefix: string, tabId: string) {
  return `${idPrefix}-${tabId}-panel`;
}

function nextTabId(tabs: PaneTab[], activeId: string, key: string) {
  const index = tabs.findIndex((tab) => tab.id === activeId);
  const current = index === -1 ? 0 : index;

  if (key === 'Home') return tabs[0]?.id;
  if (key === 'End') return tabs[tabs.length - 1]?.id;
  if (key === 'ArrowRight' || key === 'ArrowDown') return tabs[(current + 1) % tabs.length]?.id;
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return tabs[(current - 1 + tabs.length) % tabs.length]?.id;
  }
  return undefined;
}

export function PaneTabs({ tabs, active, onSelect, idPrefix, class: className }: PaneTabsProps) {
  return (
    <div class={className ? `pane-tabs ${className}` : 'pane-tabs'} role="tablist">
      {tabs.map((t) => {
        const Icon = t.icon;
        const selected = t.id === active;
        const tabId = idPrefix ? paneTabId(idPrefix, t.id) : undefined;
        const panelId = idPrefix ? panePanelId(idPrefix, t.id) : undefined;
        return (
          <button
            key={t.id}
            id={tabId}
            type="button"
            role="tab"
            aria-selected={selected ? 'true' : 'false'}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            class={selected ? 'pane-tab pane-tab--active' : 'pane-tab'}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => {
              const targetId = nextTabId(tabs, t.id, e.key);
              if (!targetId) return;
              e.preventDefault();
              onSelect(targetId);
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
