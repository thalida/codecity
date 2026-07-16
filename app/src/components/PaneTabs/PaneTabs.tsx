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
  /** id of the tabpanel these tabs control. Wires aria-controls on every tab
   *  and gives each tab a stable id (`${panelId}-tab-${tabId}`) so the panel
   *  can point its aria-labelledby back at the active tab. */
  panelId?: string;
}

export function PaneTabs({ tabs, active, onSelect, class: className, panelId }: PaneTabsProps) {
  // Arrow keys move selection within the tablist (automatic activation, like a
  // click), wrapping at the ends; Home/End jump to the first/last. Focus follows
  // to the newly selected tab, which becomes the strip's single tab stop.
  function onKeyDown(e: KeyboardEvent, idx: number) {
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (idx + 1) % tabs.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (idx - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    onSelect(tabs[next].id);
    const strip = (e.currentTarget as HTMLElement).parentElement;
    (strip?.children[next] as HTMLElement | undefined)?.focus();
  }

  return (
    <div class={className ? `pane-tabs ${className}` : 'pane-tabs'} role="tablist">
      {tabs.map((t, idx) => {
        const Icon = t.icon;
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={panelId ? `${panelId}-tab-${t.id}` : undefined}
            aria-selected={selected ? 'true' : 'false'}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            class={selected ? 'pane-tab pane-tab--active focus-inset' : 'pane-tab focus-inset'}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => onKeyDown(e, idx)}
          >
            {Icon && <Icon class="icon" aria-hidden="true" />}
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
