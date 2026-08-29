// layout/CitySidebarLeft.tsx — the left sidebar: which pane is mounted, whether it
// is collapsed, its resize handle, and the bridge between the tree pane and the
// picker.

import { NodeKind, TreeNode, PickTarget } from '@codecity/city';
import './CitySidebarLeft.css';
import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { useCity } from '@codecity/city/preact';
import { useReplayAnimation } from '@/hooks/useReplayAnimation';
import { ACTIVITY_BAR_TABS, DEFAULT_SIDEBAR_TAB, TabPlacement } from '@/constants/ui';
import { SIDEBAR_TAB, SIDEBAR_COLLAPSED } from '@/state/stores/chrome';
import { CHANGED_SETTINGS_COUNT } from '@/state/settings/indicators';
import { goToPath, hoverPath, clearHover } from '@/state/stores/city';
import { MANIFEST } from '@/state/stores/manifest';
import { PANE_MANIFEST } from '@/state/stores/timeline';
import { CURRENT_SOURCE } from '@/state/stores/source';
import { ExplorePane } from '@/views/CityView/panes/ExplorePane/ExplorePane';
import { InfoPane } from '@/views/CityView/panes/InfoPane/InfoPane';
import { SearchPane } from '@/views/CityView/panes/SearchPane/SearchPane';
import { ControlsPane } from '@/views/CityView/panes/ControlsPane/ControlsPane';
import { Sidebar, SidebarSide } from '@/components/panes/Sidebar/Sidebar';
import { SidebarTab } from '@/types/ui';

// ── Helpers ──────────────────────────────────────────────────────────

function _pathOf(target: PickTarget | null): string | null {
  if (!target) return null;
  if (target.kind === NodeKind.File) return target.file?.path ?? null;
  if (target.kind === NodeKind.Directory) return target.dir?.path ?? null;
  return null;
}

function SettingsChangeDot({ count }: { count: number }) {
  const ref = useReplayAnimation<HTMLSpanElement>(count);
  return <span ref={ref} class="activity-bar-dot" aria-hidden="true" />;
}

// ── ActivityBar sub-component ────────────────────────────────────────

interface ActivityBarProps {
  activeTab: SidebarTab;
  collapsed: boolean;
  onIconClick: (tab: SidebarTab) => void;
}

function ActivityBar({ activeTab, collapsed, onIconClick }: ActivityBarProps) {
  const tabs = ACTIVITY_BAR_TABS;
  const topTabs = tabs.filter((t) => t.placement !== TabPlacement.Bottom);
  const bottomTabs = tabs.filter((t) => t.placement === TabPlacement.Bottom);
  // One dot on the icon, since the per-tab counts live on the subtabs: a
  // customised render stays discoverable from anywhere.
  const changedCount = CHANGED_SETTINGS_COUNT.value;

  const renderTab = (tab: (typeof tabs)[number]) => {
    const isActive = !collapsed && tab.id === activeTab;
    const showDot = tab.id === SidebarTab.Controls && changedCount > 0;
    return (
      <button
        key={tab.id}
        type="button"
        class={`activity-bar-icon${isActive ? ' active' : ''}`}
        data-tab={tab.id}
        title={showDot ? `${tab.title} (${changedCount} changed from default)` : tab.title}
        aria-label={showDot ? `${tab.title}, ${changedCount} changed from default` : tab.title}
        aria-pressed={isActive}
        onClick={() => onIconClick(tab.id)}
      >
        <tab.icon class="activity-bar-glyph" />
        {showDot && <SettingsChangeDot count={changedCount} />}
      </button>
    );
  };

  return (
    <nav class="activity-bar surface-chrome" aria-label="Sidebar sections">
      <div class="activity-bar-group activity-bar-top">{topTabs.map(renderTab)}</div>
      <div class="activity-bar-group activity-bar-bottom">{bottomTabs.map(renderTab)}</div>
    </nav>
  );
}

// ── Main component ───────────────────────────────────────────────────

export function CitySidebarLeft() {
  // The city this view is about. Nothing here reads a module slot: a second
  // city on the page gets a second sidebar, pointed at its own.
  const city = useCity();
  // Both live in the store so the header can send you to a pane; still not
  // persisted, and still force-closed on every world load.
  const activeTab = SIDEBAR_TAB;
  const collapsed = SIDEBAR_COLLAPSED;

  // Tree selection + hover paths, derived from the city's picker.
  const selectedPath = useSignal<string | null>(null);
  const hoveredPath = useSignal<string | null>(null);
  // TreePane drives this itself; it just needs somewhere long-lived to live.
  const treeExpanded = useSignal<Set<string>>(new Set());

  // Signals rather than plain values because TreeTab subscribes per row: a
  // hover repaints the row under the cursor, not the whole tree. That is the
  // one reason to carry the city's own reports into signals here.
  useEffect(() => {
    if (!city) {
      selectedPath.value = null;
      hoveredPath.value = null;
      return;
    }
    const sync = () => {
      selectedPath.value = _pathOf(city.picker.selection);
      hoveredPath.value = _pathOf(city.picker.hover);
    };
    sync();
    const offs = [city.on('select', sync), city.on('hover', sync)];
    return () => {
      for (const off of offs) off();
    };
  }, [city]);

  // Closed on every world commit, so a new city opens unobscured. Live reloads
  // don't write CURRENT_SOURCE, so this can't fight a manual change.
  useSignalEffect(() => {
    if (CURRENT_SOURCE.value) {
      activeTab.value = DEFAULT_SIDEBAR_TAB;
      collapsed.value = true;
    }
  });

  // Auto-collapse when the manifest has no content (cold-boot empty state).
  // The activity bar stays visible but the panel is hidden.
  const manifestIsEmpty = useComputed(() => !MANIFEST.value);

  const onIconClick = (tab: SidebarTab) => {
    if (!collapsed.value && tab === activeTab.value) {
      collapsed.value = true;
      return;
    }
    if (collapsed.value) collapsed.value = false;
    activeTab.value = tab;
  };

  const onPaneClose = () => {
    collapsed.value = true;
  };

  // Bound at call time, so they always reach the live scene. Rows hand back a
  // node; the path-shaped handlers use the scene commands directly below.
  const onTreeSelect = (node: TreeNode) => {
    if (node?.path) goToPath(node.path);
  };
  const onTreeHover = (node: TreeNode) => {
    if (node?.path) hoverPath(node.path);
  };

  // Effective collapsed: forced when manifest is empty.
  const effectiveCollapsed = collapsed.value || manifestIsEmpty.value;
  const tab = activeTab.value;

  return (
    <Sidebar
      id="city-sidebar-left"
      side={SidebarSide.Left}
      ariaLabel="Explore"
      class={effectiveCollapsed ? 'is-collapsed' : ''}
      open={!effectiveCollapsed}
    >
      <ActivityBar activeTab={tab} collapsed={effectiveCollapsed} onIconClick={onIconClick} />
      <div class="pane">
        {tab === SidebarTab.Explore && (
          <ExplorePane
            manifest={PANE_MANIFEST}
            selectedPath={selectedPath}
            hoveredPath={hoveredPath}
            expanded={treeExpanded}
            rootPath={(PANE_MANIFEST.value as { tree?: TreeNode })?.tree?.path ?? ''}
            onClose={onPaneClose}
            onSelect={onTreeSelect}
            onHover={onTreeHover}
            onHoverEnd={clearHover}
          />
        )}
        {tab === SidebarTab.Search && (
          <SearchPane manifest={PANE_MANIFEST} onClose={onPaneClose} onSelect={goToPath} />
        )}
        {tab === SidebarTab.Info && <InfoPane manifest={MANIFEST} onClose={onPaneClose} />}
        {tab === SidebarTab.Controls && (
          <ControlsPane onClose={onPaneClose} collapsed={effectiveCollapsed} />
        )}
      </div>
    </Sidebar>
  );
}
